import { Injectable, OnModuleInit, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers, Contract, WebSocketProvider, Provider } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class BlockchainService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BlockchainService.name);
  private provider: WebSocketProvider | null = null;
  private providerReady = false;
  public contracts: {
    propertyTokenFactory?: Contract;
    propertyNFT?: Contract;
    propertyRegistry?: Contract;
    rentDistribution?: Contract;
    propertyMarketplace?: Contract;
    propertyDAO?: Contract;
    usdcToken?: Contract;
    // Individual property tokens are now handled dynamically
  } = {};
  // Map to store dynamically loaded property token contracts, keyed by lowercase address
  private propertyTokenContracts: Map<string, Contract> = new Map();

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const rpcUrl = this.configService.get<string>('BASE_SEPOLIA_RPC_URL');
    if (!rpcUrl || !rpcUrl.startsWith('wss://')) {
      this.logger.error('BASE_SEPOLIA_RPC_URL is not configured or is not a WSS URL.');
      throw new Error('Missing or invalid WSS BASE_SEPOLIA_RPC_URL configuration');
    }

    this.logger.log(`Attempting to connect to blockchain via WebSocket: ${rpcUrl}`);
    try {
      this.provider = new ethers.WebSocketProvider(rpcUrl);

      await this.provider.ready;
      this.logger.log('WebSocket Provider is ready.');
      this.providerReady = true;
      await this.initializeCoreContracts(); // Renamed for clarity
      await this.initializeAllPropertyTokens(); // New method call
    } catch (error) {
      this.logger.error(`Failed to initialize WebSocket provider or contracts: ${error.message}`);
      this.provider = null;
      this.providerReady = false;
    }
  }

  async onModuleDestroy() {
    if (this.provider) {
      this.logger.log('Closing WebSocket Provider connection...');
      // propertyTokenContracts are derived from provider, no need to clear explicitly before provider.destroy()
      this.propertyTokenContracts.clear();
      await this.provider.destroy();
      this.provider = null;
      this.providerReady = false;
      this.logger.log('WebSocket Provider connection closed.');
    }
  }

  private async initializeCoreContracts() { // Renamed from initializeContracts
    if (!this.provider || !this.providerReady) {
      this.logger.error('Cannot initialize core contracts: Provider is not ready.');
      return;
    }
    const abiDirectory = path.join(__dirname, '../../abis');
    const contractConfigs = [
      { name: 'propertyTokenFactory', addressEnv: 'PROPERTY_TOKEN_FACTORY_ADDRESS', abiFile: 'PropertyTokenFactory.json' },
      { name: 'propertyNFT', addressEnv: 'PROPERTY_NFT_ADDRESS', abiFile: 'PropertyNFT.json' },
      { name: 'propertyRegistry', addressEnv: 'PROPERTY_REGISTRY_ADDRESS', abiFile: 'PropertyRegistry.json' },
      { name: 'rentDistribution', addressEnv: 'RENT_DISTRIBUTION_ADDRESS', abiFile: 'RentDistribution.json' },
      { name: 'propertyMarketplace', addressEnv: 'PROPERTY_MARKETPLACE_ADDRESS', abiFile: 'PropertyMarketplace.json' },
      { name: 'propertyDAO', addressEnv: 'PROPERTY_DAO_ADDRESS', abiFile: 'PropertyDAO.json' },
      { name: 'usdcToken', addressEnv: 'USDC_TOKEN_ADDRESS', abiFile: 'ERC20.json' },
      // Removed MBV, MLC, SFMT, CDP specific entries
    ];

    for (const config of contractConfigs) {
      const address = this.configService.get<string>(config.addressEnv);
      const abiPath = path.join(abiDirectory, config.abiFile);

      if (!address) {
        this.logger.warn(`${config.addressEnv} address not found in config for ${config.name}.`);
        continue; // Use continue instead of return to process other configs
      }
      if (!fs.existsSync(abiPath)) {
        this.logger.error(`ABI file not found at runtime path for ${config.name}: ${abiPath}`);
        continue;
      }

      try {
        const abi = JSON.parse(fs.readFileSync(abiPath, 'utf8'));
        this.contracts[config.name] = new ethers.Contract(address, abi, this.provider);
        this.logger.log(`Initialized core contract ${config.name} at ${address}`);
      } catch (error) {
        this.logger.error(`Failed to initialize core contract ${config.name}: ${error.message}`);
      }
    }
  }

  private async initializeAllPropertyTokens() {
    if (!this.provider || !this.providerReady) {
      this.logger.error('Cannot initialize property tokens: Provider is not ready.');
      return;
    }
    const propertyTokenFactory = this.contracts.propertyTokenFactory;
    if (!propertyTokenFactory) {
      this.logger.error('PropertyTokenFactory contract is not initialized. Cannot fetch all property tokens.');
      return;
    }

    const abiDirectory = path.join(__dirname, '../../abis');
    const propertyTokenAbiPath = path.join(abiDirectory, 'PropertyToken.json');
    if (!fs.existsSync(propertyTokenAbiPath)) {
      this.logger.error(`PropertyToken ABI file not found at ${propertyTokenAbiPath}. Cannot initialize dynamic property tokens.`);
      return;
    }
    const propertyTokenAbi = JSON.parse(fs.readFileSync(propertyTokenAbiPath, 'utf8'));

    try {
      this.logger.log('Fetching all property token addresses from PropertyTokenFactory...');
      const tokenAddresses: string[] = await propertyTokenFactory.getAllTokens();
      this.logger.log(`Found ${tokenAddresses.length} property token addresses from factory.`);

      for (const address of tokenAddresses) {
        try {
          const contractInstance = new ethers.Contract(address, propertyTokenAbi, this.provider);
          // Optional: Fetch symbol to log more descriptively, but adds async calls
          // const symbol = await contractInstance.symbol();
          // this.logger.log(`Initialized dynamic PropertyToken (${symbol || 'N/A'}) at ${address}`);
          this.logger.log(`Initialized dynamic PropertyToken at ${address}`);
          this.propertyTokenContracts.set(address.toLowerCase(), contractInstance);
        } catch (error) {
          this.logger.error(`Failed to initialize dynamic PropertyToken at ${address}: ${error.message}`);
        }
      }
      this.logger.log(`Finished initializing ${this.propertyTokenContracts.size} dynamic property tokens.`);
    } catch (error) {
      this.logger.error(`Error fetching or initializing dynamic property tokens: ${error.message}`);
    }
  }

  getProvider(): Provider | null {
    return this.provider;
  }

  getContract(name: keyof BlockchainService['contracts']): Contract | undefined {
    if (!this.providerReady) {
      this.logger.warn(`Attempted to get core contract ${name} before provider is ready.`);
      return undefined;
    }
    if (!this.contracts[name]) {
      this.logger.warn(`Attempted to access uninitialized or unavailable core contract: ${name}`);
    }
    return this.contracts[name];
  }

  // Get a property token contract by its address (dynamically loaded)
  getPropertyTokenByAddress(address: string): Contract | undefined {
    if (!this.providerReady) {
      this.logger.warn(`Attempted to get property token ${address} before provider is ready.`);
      return undefined;
    }
    if (!address) {
        this.logger.warn('getPropertyTokenByAddress called with no address.');
        return undefined;
    }
    const normalizedAddress = address.toLowerCase();
    const contract = this.propertyTokenContracts.get(normalizedAddress);
    if (!contract) {
        this.logger.warn(`PropertyToken contract not found for address: ${address} (Normalized: ${normalizedAddress}). Available: ${Array.from(this.propertyTokenContracts.keys()).join(', ')}`);
    }
    return contract;
  }

  // Helper to get all dynamically loaded property token contracts
  getAllPropertyTokenContracts(): Contract[] {
    if (!this.providerReady) {
        this.logger.warn('Attempted to get all property tokens before provider is ready.');
        return [];
    }
    return Array.from(this.propertyTokenContracts.values());
  }
  
  // getPropertyTokenByType might be deprecated or need rework if type isn't directly available.
  // For now, it's removed as dynamic loading focuses on addresses.
  // If symbols are reliably fetched and mapped, it could be revived.
} 