import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { ValidateTokenDto } from './dto/validate-token.dto';
import { UsersService } from '../users/users.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
  ) {}

  @Get('me')
  async me(@Headers('authorization') authorization: string | undefined) {
    const raw = authorization ?? '';
    const token = raw.startsWith('Bearer ') ? raw.slice(7).trim() : null;
    if (!token) {
      throw new UnauthorizedException('Missing or invalid Authorization header');
    }
    const payload = await this.authService.validateToken(token);
    const user = await this.usersService.findById(payload.userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    const userId = (user as any)._id?.toString?.() ?? (user as any).id;
    return {
      id: userId,
      name: user.name,
      email: user.email,
      role: user.role,
    };
  }

  @Post('register')
  async register(@Body() dto: RegisterDto) {
    const { user, tokens } = await this.authService.register({
      name: dto.name,
      email: dto.email,
      password: dto.password,
      role: dto.role,
    });

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      tokens,
    };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto) {
    const { user, tokens } = await this.authService.login({
      email: dto.email,
      password: dto.password,
    });

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      tokens,
    };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshDto) {
    const refreshToken = typeof dto.refreshToken === 'string' ? dto.refreshToken.trim() : '';
    const { user, tokens } = await this.authService.refreshTokens({
      refreshToken,
    });

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      tokens,
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Headers('authorization') authorization: string | undefined) {
    const raw = authorization ?? '';
    const token = raw.startsWith('Bearer ') ? raw.slice(7).trim() : null;
    if (!token) {
      throw new UnauthorizedException('Missing or invalid Authorization header');
    }
    await this.authService.logoutByAccessToken(token);
  }

  @Post('validate')
  @HttpCode(HttpStatus.OK)
  async validate(@Body() dto: ValidateTokenDto) {
    const payload = await this.authService.validateToken(dto.token);
    return payload;
  }
}

