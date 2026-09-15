import {
  HttpException,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IMPORT_UPLOAD_FILE_FIELD } from '@smarttag/shared-types';
import type { Observable } from 'rxjs';
import { AppError } from '../../common/errors/app-error';

const MulterFileInterceptor = FileInterceptor(IMPORT_UPLOAD_FILE_FIELD);

/**
 * Multipart parsing for source uploads (limits from DataModule's MulterModule). Oversized files are
 * rejected while streaming, before the whole body is buffered, as IMPORT_FILE_TOO_LARGE.
 */
@Injectable()
export class ImportUploadInterceptor extends MulterFileInterceptor implements NestInterceptor {
  override async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    try {
      return await super.intercept(context, next);
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === 413) {
        throw new AppError(
          'IMPORT_FILE_TOO_LARGE',
          'The file is larger than the upload limit for data imports.',
        );
      }
      throw error;
    }
  }
}
