import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class RosterLookupDto {
  @IsString()
  @MaxLength(254)
  email: string;
}

export class RosterEnterDto extends RosterLookupDto {
  @IsString()
  @MaxLength(80)
  memberId: string;
}

export class RosterTeamDto {
  @IsInt()
  @Min(1)
  number: number;

  @IsString()
  @Matches(/\S/)
  @MaxLength(120)
  name: string;

  @IsEmail()
  leadEmail: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(6)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  members: string[];

  @IsOptional()
  @IsString()
  @MaxLength(60)
  slot?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  date?: string;
}

export class RosterImportDto {
  @IsOptional()
  @IsString()
  event?: string;

  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => RosterTeamDto)
  teams: RosterTeamDto[];
}
