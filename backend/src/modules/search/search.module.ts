import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  imports: [FilesModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
