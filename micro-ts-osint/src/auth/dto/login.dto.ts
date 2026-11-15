import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({
    description: 'Nombre de usuario',
    example: 'operator@example.com',
  })
  @IsString()
  @IsNotEmpty()
  username: string;

  @ApiProperty({
    description: 'Contraseña',
    example: 'use-env-password',
    minLength: 6,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password: string;
}

export class AuthResponseDto {
  @ApiProperty({
    description: 'Token JWT de acceso',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  accessToken: string;

  @ApiProperty({
    description: 'Tipo de token',
    example: 'Bearer',
  })
  tokenType: string;

  @ApiProperty({
    description: 'Tiempo de expiración en segundos',
    example: 86400,
  })
  expiresIn: number;

  @ApiProperty({
    description: 'Usuario autenticado',
    example: { userId: 'test-user', role: 'admin' },
  })
  user: {
    userId: string;
    username: string;
    email?: string;
    role: string;
    mustChangePassword?: boolean;
  };
}
