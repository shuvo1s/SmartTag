import { Module } from '@nestjs/common';
import { TemplateDataService } from './template-data.service';
import { TemplateDocumentService } from './template-document.service';
import { TemplateVersionsController } from './template-versions.controller';
import { TemplateVersionsService } from './template-versions.service';
import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';

@Module({
  controllers: [TemplatesController, TemplateVersionsController],
  providers: [
    TemplatesService,
    TemplateVersionsService,
    TemplateDocumentService,
    TemplateDataService,
  ],
})
export class TemplatesModule {}
