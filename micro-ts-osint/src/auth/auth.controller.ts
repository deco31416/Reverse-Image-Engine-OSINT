import { Body, Controller, Get, HttpCode, HttpStatus, Logger, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthService } from './auth.service';
import { LoginDto, AuthResponseDto } from './dto/login.dto';
import { ChangePasswordDto, CreateUserDto, ForgotPasswordDto, ResetPasswordDto } from './dto/access.dto';

/**
 * Controlador de Autenticación
 * 
 * Endpoints públicos para login y gestión de tokens JWT
 */
@ApiTags('Autenticación')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private authService: AuthService) {}

  /**
   * POST /api/v1/auth/login
   * Autenticar usuario y obtener token JWT
   * 
   * Credenciales definidas por entorno:
   * - OSINT_VALID_USERS
   * - OSINT_AUTH_PASSWORD
   */
  @Public() // No requiere auth previa
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Login de usuario',
    description: `
      Autenticación JWT para acceso al sistema OSINT.
      
      Credenciales definidas por variables de entorno:
      - OSINT_VALID_USERS
      - OSINT_AUTH_PASSWORD
      
      En producción se recomienda integrar validación contra base de datos con bcrypt o proveedor IAM.
    `,
  })
  @ApiResponse({
    status: 200,
    description: 'Login exitoso - Token JWT generado',
    type: AuthResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Credenciales inválidas',
  })
  async login(@Body() loginDto: LoginDto, @Req() req: any): Promise<AuthResponseDto> {
    this.logger.log(`🔐 Login request from: ${loginDto.username}`);
    return this.authService.login(loginDto, req.ip);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Solicitar recuperación de contraseña' })
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: any) {
    return this.authService.forgotPassword(dto, req.ip);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Restablecer contraseña con token temporal' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Perfil del usuario autenticado' })
  async me(@CurrentUser() user: any) {
    return this.authService.me(user);
  }

  @Get('users')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Listar usuarios del sistema' })
  async users() {
    return this.authService.listUsers();
  }

  @Post('users')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear usuario por administrador' })
  async createUser(@Body() dto: CreateUserDto) {
    return this.authService.createUser(dto);
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cambiar contraseña del usuario autenticado' })
  async changePassword(@CurrentUser() user: any, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(user, dto);
  }
}
