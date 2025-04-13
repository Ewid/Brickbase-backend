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
    // Add USDC token
    usdcToken?: Contract;
    // Individual property tokens
    mbvToken?: Contract;
    mlcToken?: Contract;
    sfmtToken?: Contract;
    cdpToken?: Contract;
  } = {};

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

      // Wait for the provider to be ready (initial connection)
      await this.provider.ready;
      this.logger.log('WebSocket Provider is ready.');
      this.providerReady = true;
      this.initializeContracts();
    } catch (error) {
      this.logger.error(`Failed to initialize WebSocket provider: ${error.message}`);
      this.provider = null; // Ensure provider is null if connection failed
       this.providerReady = false;
    }
  }

  async onModuleDestroy() {
    if (this.provider) {
      this.logger.log('Closing WebSocket Provider connection...');
      await this.provider.destroy();
      this.provider = null;
      this.providerReady = false;
      this.logger.log('WebSocket Provider connection closed.');
    }
  }

  private initializeContracts() {
    if (!this.provider || !this.providerReady) {
      this.logger.error('Cannot initialize contracts: Provider is not ready.');
      return;
    }
    const abiDirectory = path.join(__dirname, '../../abis'); // Assumes abis folder is at dist/abis
    const contractConfigs = [
      { name: 'propertyTokenFactory', addressEnv: 'PROPERTY_TOKEN_FACTORY_ADDRESS', abiFile: 'PropertyTokenFactory.json' },
      { name: 'propertyNFT', addressEnv: 'PROPERTY_NFT_ADDRESS', abiFile: 'PropertyNFT.json' },
      { name: 'propertyRegistry', addressEnv: 'PROPERTY_REGISTRY_ADDRESS', abiFile: 'PropertyRegistry.json' },
      { name: 'rentDistribution', addressEnv: 'RENT_DISTRIBUTION_ADDRESS', abiFile: 'RentDistribution.json' },
      { name: 'propertyMarketplace', addressEnv: 'PROPERTY_MARKETPLACE_ADDRESS', abiFile: 'PropertyMarketplace.json' },
      { name: 'propertyDAO', addressEnv: 'PROPERTY_DAO_ADDRESS', abiFile: 'PropertyDAO.json' },
      // USDC token (using ERC20 ABI)
      { name: 'usdcToken', addressEnv: 'USDC_TOKEN_ADDRESS', abiFile: 'ERC20.json' },
      // Individual property tokens (all use PropertyToken ABI)
      { name: 'mbvToken', addressEnv: 'MBV_TOKEN_ADDRESS', abiFile: 'PropertyToken.json' },
      { name: 'mlcToken', addressEnv: 'MLC_TOKEN_ADDRESS', abiFile: 'PropertyToken.json' },
      { name: 'sfmtToken', addressEnv: 'SFMT_TOKEN_ADDRESS', abiFile: 'PropertyToken.json' },
      { name: 'cdpToken', addressEnv: 'CDP_TOKEN_ADDRESS', abiFile: 'PropertyToken.json' },
    ];

    contractConfigs.forEach(config => {
      const address = this.configService.get<string>(config.addressEnv);
      const abiPath = path.join(abiDirectory, config.abiFile);

      if (!address) {
        this.logger.warn(`${config.addressEnv} address not found in config.`);
        return;
      }
      if (!fs.existsSync(abiPath)) {
        this.logger.error(`ABI file not found at runtime path: ${abiPath}`);
        return;
      }

      try {
        const abi = JSON.parse(fs.readFileSync(abiPath, 'utf8'));
        this.contracts[config.name] = new ethers.Contract(address, abi, this.provider);
        this.logger.log(`Initialized contract ${config.name} at ${address}`);
      } catch (error) {
        this.logger.error(`Failed to initialize contract ${config.name}: ${error.message}`);
      }
    });
  }

  getProvider(): Provider | null {
    return this.provider;
  }

  getContract(name: keyof BlockchainService['contracts']): Contract | undefined {
    if (!this.providerReady) {
        this.logger.warn(`Attempted to get contract ${name} before provider is ready.`);
        return undefined;
    }
    if (!this.contracts[name]) {
        this.logger.warn(`Attempted to access uninitialized or unavailable contract: ${name}`);
     }
    return this.contracts[name];
  }

  // Helper to get a property token by its type or address
  getPropertyTokenByType(propertyType: string): Contract | undefined {
    switch (propertyType.toLowerCase()) {
      case 'mbv':
      case 'miami':
        return this.contracts.mbvToken;
      case 'mlc':
      case 'manhattan':
        return this.contracts.mlcToken;
      case 'sfmt':
      case 'san francisco':
        return this.contracts.sfmtToken;
      case 'cdp':
      case 'chicago':
        return this.contracts.cdpToken;
      default:
        return undefined;
    }
  }

  // Get a token contract by its address
  getPropertyTokenByAddress(address: string): Contract | undefined {
    if (!address) return undefined;
    
    // Normalize the address for comparison
    const normalizedAddress = address.toLowerCase();
    
    // Check each property token
    for (const key of ['mbvToken', 'mlcToken', 'sfmtToken', 'cdpToken']) {
      const contract = this.contracts[key];
      if (contract && contract.target.toLowerCase() === normalizedAddress) {
        return contract;
      }
    }
    
    return undefined;
  }
} 