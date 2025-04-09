import { Module } from '@nestjs/common';
import { DaoService } from './dao.service';
import { DaoController } from './dao.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExpenseRecord } from './entities/expense-record.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ExpenseRecord])],
  controllers: [DaoController],
  providers: [DaoService],
})
export class DaoModule {} 