import { Module } from '@nestjs/common';
import { DaoService } from './dao.service';
import { DaoController } from './dao.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExpenseRecord } from './entities/expense-record.entity';
import { PropertiesModule } from '../properties/properties.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ExpenseRecord]),
    PropertiesModule
  ],
  controllers: [DaoController],
  providers: [DaoService],
})
export class DaoModule {} 