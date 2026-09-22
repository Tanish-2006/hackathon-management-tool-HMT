import { SetMetadata } from '@nestjs/common';
import type { Role } from '@hmt/common';

export const ROLES_KEY = 'hmt:roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
