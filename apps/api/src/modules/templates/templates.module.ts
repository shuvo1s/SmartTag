import { Module } from '@nestjs/common';
import { TemplateDocumentService } from './template-document.service';
import { TemplateVersionsController } from './template-versions.controller';
import { TemplateVersionsService } from './template-versions.service';
import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';

@Module({
  controllers: [TemplatesController, TemplateVersionsController],
  providers: [TemplatesService, TemplateVersionsService, TemplateDocumentService],
})
export class TemplatesModule {}
