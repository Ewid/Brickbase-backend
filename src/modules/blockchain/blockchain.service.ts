import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers, Contract, JsonRpcProvider } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class BlockchainService implements OnModuleInit {
  private readonly logger = new Logger(BlockchainService.name);
  private provider: JsonRpcProvider;
  public contracts: {
    propertyToken?: Contract;
    propertyNFT?: Contract;
    propertyRegistry?: Contract;
    rentDistribution?: Contract;
    propertyMarketplace?: Contract;
    propertyDAO?: Contract;
  } = {};

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const rpcUrl = this.configService.get<string>('BASE_SEPOLIA_RPC_URL');
    if (!rpcUrl) {
      this.logger.error('BASE_SEPOLIA_RPC_URL is not configured.');
      throw new Error('Missing BASE_SEPOLIA_RPC_URL configuration');
    }
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.logger.log(`Connected to blockchain via ${rpcUrl}`);
    this.initializeContracts();
  }

  private initializeContracts() {
    const abiDirectory = path.join(__dirname, '../../abis'); // Assumes abis folder is at src/abis
    const contractConfigs = [
      { name: 'propertyToken', addressEnv: 'PROPERTY_TOKEN_ADDRESS', abiFile: 'PropertyToken.json' },
      { name: 'propertyNFT', addressEnv: 'PROPERTY_NFT_ADDRESS', abiFile: 'PropertyNFT.json' },
      { name: 'propertyRegistry', addressEnv: 'PROPERTY_REGISTRY_ADDRESS', abiFile: 'PropertyRegistry.json' },
      { name: 'rentDistribution', addressEnv: 'RENT_DISTRIBUTION_ADDRESS', abiFile: 'RentDistribution.json' },
      { name: 'propertyMarketplace', addressEnv: 'PROPERTY_MARKETPLACE_ADDRESS', abiFile: 'PropertyMarketplace.json' },
      { name: 'propertyDAO', addressEnv: 'PROPERTY_DAO_ADDRESS', abiFile: 'PropertyDAO.json' },
    ];

    contractConfigs.forEach(config => {
      const address = this.configService.get<string>(config.addressEnv);
      const abiPath = path.join(abiDirectory, config.abiFile);

      if (!address) {
        this.logger.warn(`${config.addressEnv} address not found in config.`);
        return;
      }
      if (!fs.existsSync(abiPath)) {
        this.logger.warn(`ABI file not found at ${abiPath}`);
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

  getProvider(): JsonRpcProvider {
    return this.provider;
  }

  getContract(name: keyof BlockchainService['contracts']): Contract | undefined {
     if (!this.contracts[name]) {
        this.logger.warn(`Attempted to access uninitialized contract: ${name}`);
     }
    return this.contracts[name];
  }
} 