import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BlockchainService } from '../blockchain/blockchain.service';
import { ExpenseRecord, ExpenseStatus } from './entities/expense-record.entity';
import { ethers, Contract, Log, EventLog, ZeroAddress } from 'ethers';
import { ProposalDto } from './dto/proposal.dto';

@Injectable()
export class DaoService implements OnModuleInit {
  private readonly logger = new Logger(DaoService.name);

  constructor(
    @InjectRepository(ExpenseRecord)
    private expenseRecordRepository: Repository<ExpenseRecord>,
    private blockchainService: BlockchainService,
  ) {
  }

  onModuleInit() {
    this.listenForExpenseProposals();
  }

  private formatProposalData(proposalData: any): ProposalDto {
    return {
        id: Number(proposalData.id),
        proposer: proposalData.proposer,
        description: proposalData.description,
        targetContract: proposalData.targetContract,
        functionCall: proposalData.functionCall,
        votesFor: proposalData.votesFor.toString(),
        votesAgainst: proposalData.votesAgainst.toString(),
        startTime: Number(proposalData.startTime),
        endTime: Number(proposalData.endTime),
        executed: proposalData.executed,
        passed: proposalData.passed,
    };
  }

  private async addStateToProposal(proposal: ProposalDto, propertyDAO: Contract): Promise<ProposalDto> {
      try {
          const state = await (propertyDAO as any).getProposalState(proposal.id);
          return { ...proposal, state: state };
      } catch (error) {
          this.logger.error(`Error fetching state for proposal ${proposal.id}: ${error.message}`);
          return { ...proposal, state: 'ErrorFetchingState' };
      }
  }

  async getDaoProposals(): Promise<ProposalDto[]> {
    this.logger.log('Fetching DAO proposals...');
    const propertyDAO = this.blockchainService.getContract('propertyDAO');

     if (!propertyDAO) {
        this.logger.error('PropertyDAO contract not available from BlockchainService');
        return [];
     }
    try {
        const rawProposals: any[] = await (propertyDAO as any).getAllProposals();
        const formattedProposals = rawProposals.map((p) => this.formatProposalData(p));

        const proposalsWithState = await Promise.all(
            formattedProposals.map(p => this.addStateToProposal(p, propertyDAO))
        );

        return proposalsWithState;
    } catch (error) {
        this.logger.error(`Error fetching DAO proposals: ${error.message}`);
        return [];
    }
  }

  async getProposalDetails(proposalId: number): Promise<ProposalDto | null> {
    this.logger.log(`Fetching details for proposal ${proposalId}...`);
    const propertyDAO = this.blockchainService.getContract('propertyDAO');

     if (!propertyDAO) {
        this.logger.error('PropertyDAO contract not available from BlockchainService');
        return null;
     }
    try {
        const rawProposal = await (propertyDAO as any).proposals(proposalId);
        if (!rawProposal || rawProposal.proposer === ZeroAddress) {
            this.logger.warn(`Proposal ${proposalId} not found.`);
            return null;
        }
        const formattedProposal = this.formatProposalData(rawProposal);
        const proposalWithState = await this.addStateToProposal(formattedProposal, propertyDAO);
        return proposalWithState;
    } catch (error) {
        this.logger.error(`Error fetching proposal details for ${proposalId}: ${error.message}`);
        return null;
    }
  }

  async getExpenseProposals(propertyNftId?: string): Promise<ExpenseRecord[]> {
    this.logger.log(`Fetching expense records ${propertyNftId ? 'for property ' + propertyNftId : ''}...`);
    const whereClause: any = {};
    if (propertyNftId) {
      whereClause.propertyNftId = propertyNftId;
    }
    try {
        return this.expenseRecordRepository.find({ where: whereClause });
    } catch (error) {
        this.logger.error(`Error fetching expense proposals from database: ${error.message}`);
        return [];
    }
  }

  private listenForExpenseProposals() {
    const propertyDAO = this.blockchainService.getContract('propertyDAO');
    if (!propertyDAO) {
      this.logger.error('Cannot listen for Proposals: PropertyDAO contract not available');
      return;
    }

    this.logger.log('Setting up listener for ProposalCreated events...');

    propertyDAO.on('ProposalCreated', async (proposalId, proposer, description, event: EventLog) => {
        const proposalIdNum = Number(proposalId);
        this.logger.log(`ProposalCreated event received: id=${proposalIdNum}, desc=${description}`);

        const isExpenseProposal = description.toLowerCase().includes('expense:');

        if (isExpenseProposal) {
            this.logger.log(`Identified potential expense proposal: ${proposalIdNum}`);
            try {
                const parsedAmount = 100;
                const parsedCurrency = 'USD';
                const parsedPropertyNftId = 'N/A';

                const existingRecord = await this.expenseRecordRepository.findOne({ where: { daoProposalId: proposalIdNum.toString() } });
                if (existingRecord) {
                    this.logger.log(`Expense record for proposal ${proposalIdNum} already exists.`);
                    return;
                }

                const expense = this.expenseRecordRepository.create({
                    daoProposalId: proposalIdNum.toString(),
                    propertyNftId: parsedPropertyNftId,
                    description: description,
                    amount: parsedAmount,
                    currency: parsedCurrency,
                    status: ExpenseStatus.PENDING,
                });
                await this.expenseRecordRepository.save(expense);
                this.logger.log(`Saved new expense record for proposal ${proposalIdNum}`);
            } catch (error) {
                this.logger.error(`Error processing ProposalCreated event for expense: ${error.message}`);
            }
        }
    });
  }
} 