import { Module, Global } from '@nestjs/common';
import { PrivacyService } from './privacy.service';
@Global()
@Module({
  providers: [PrivacyService],
  exports: [PrivacyService],
})
export class PrivacyModule {}
