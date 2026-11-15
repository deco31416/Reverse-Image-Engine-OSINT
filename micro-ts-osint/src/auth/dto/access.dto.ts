import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateUserDto {
  @ApiProperty({ example: 'operator@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'operator' })
  @IsString()
  @IsNotEmpty()
  username: string;

  @ApiProperty({ minLength: 10 })
  @IsString()
  @MinLength(10)
  password: string;

  @ApiPropertyOptional({ example: 'Analista OSINT' })
  @IsOptional()
  @IsString()
  displayName?: string;
  @ApiPropertyOptional({ enum: ['admin', 'analyst', 'viewer'], default: 'analyst' })
  @IsOptional()
  @IsIn(['admin', 'analyst', 'viewer'])
  role?: 'admin' | 'analyst' | 'viewer';
}

export class ForgotPasswordDto {
  @ApiProperty({ example: 'operator@example.com' })
  @IsString()
  @IsNotEmpty()
  identifier: string;
}

export class ResetPasswordDto {
  @ApiProperty({ example: 'reset-token-from-email' })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({ example: 'new-secure-password', minLength: 10 })
  @IsString()
  @MinLength(10)
  password: string;
}

export class ChangePasswordDto {
  @ApiProperty({ example: 'current-password' })
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  @ApiProperty({ example: 'new-secure-password', minLength: 10 })
  @IsString()
  @MinLength(10)
  newPassword: string;
}
