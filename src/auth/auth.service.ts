import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { User, UserRole } from '../users/user.model';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface TokenPayload {
  sub: string;
  email: string;
  role: UserRole;
}

export interface ValidatedUserPayload {
  userId: string;
  email: string;
  role: UserRole;
}

@Injectable()
export class AuthService {
  private readonly bcryptSaltRounds = 10;

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async register(params: {
    name: string;
    email: string;
    password: string;
    role?: UserRole;
  }): Promise<{ user: User; tokens: AuthTokens }> {
    const existing = await this.usersService.findByEmail(params.email.toLowerCase());
    if (existing) {
      throw new BadRequestException('Email already in use');
    }

    const passwordHash = await this.hashData(params.password);

    const user = await this.usersService.createUser({
      name: params.name,
      email: params.email.toLowerCase(),
      passwordHash,
      role: params.role,
    });

    const tokens = await this.getTokens(user);
    const refreshTokenHash = await this.hashData(tokens.refreshToken);
    await this.usersService.setRefreshTokenHash(user.id, refreshTokenHash);

    return { user, tokens };
  }

  async login(params: {
    email: string;
    password: string;
  }): Promise<{ user: User; tokens: AuthTokens }> {
    const user = await this.usersService.findByEmail(params.email.toLowerCase());
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatches = await bcrypt.compare(params.password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await this.getTokens(user);
    const refreshTokenHash = await this.hashData(tokens.refreshToken);
    await this.usersService.setRefreshTokenHash(user.id, refreshTokenHash);

    return { user, tokens };
  }

  async refreshTokens(params: {
    refreshToken: string;
  }): Promise<{ user: User; tokens: AuthTokens }> {
    const refreshSecret = this.configService.get<string>('JWT_REFRESH_SECRET');
    if (!refreshSecret) {
      throw new Error('JWT_REFRESH_SECRET is not configured');
    }

    let payload: TokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<TokenPayload>(params.refreshToken, {
        secret: refreshSecret,
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user || !user.refreshTokenHash) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const refreshMatches = await bcrypt.compare(
      params.refreshToken,
      user.refreshTokenHash,
    );
    if (!refreshMatches) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokens = await this.getTokens(user);
    const newRefreshHash = await this.hashData(tokens.refreshToken);
    await this.usersService.setRefreshTokenHash(user.id, newRefreshHash);

    return { user, tokens };
  }

  async logout(params: { refreshToken: string }): Promise<void> {
    const refreshSecret = this.configService.get<string>('JWT_REFRESH_SECRET');
    if (!refreshSecret) {
      throw new Error('JWT_REFRESH_SECRET is not configured');
    }

    let payload: TokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<TokenPayload>(params.refreshToken, {
        secret: refreshSecret,
      });
    } catch {
      // If token is invalid, we just do nothing specific for simplicity
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    await this.usersService.setRefreshTokenHash(user.id, null);
  }

  async validateToken(token: string): Promise<ValidatedUserPayload> {
    const accessSecret = this.configService.get<string>('JWT_ACCESS_SECRET');
    if (!accessSecret) {
      throw new Error('JWT_ACCESS_SECRET is not configured');
    }

    let payload: TokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<TokenPayload>(token, {
        secret: accessSecret,
      });
    } catch {
      throw new UnauthorizedException('Invalid access token');
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('Invalid access token');
    }

    return {
      userId: user.id,
      email: user.email,
      role: user.role,
    };
  }

  private async getTokens(user: User): Promise<AuthTokens> {
    const payload: TokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    const accessSecret = this.configService.get<string>('JWT_ACCESS_SECRET');
    const accessExpiresIn =
      this.configService.get<string>('JWT_ACCESS_EXPIRES_IN') || '15m';

    const refreshSecret = this.configService.get<string>('JWT_REFRESH_SECRET');
    const refreshExpiresIn =
      this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') || '7d';

    if (!accessSecret || !refreshSecret) {
      throw new Error('JWT secrets are not configured');
    }

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: accessSecret,
        expiresIn: accessExpiresIn,
      }),
      this.jwtService.signAsync(payload, {
        secret: refreshSecret,
        expiresIn: refreshExpiresIn,
      }),
    ]);

    return { accessToken, refreshToken };
  }

  private async hashData(data: string): Promise<string> {
    return bcrypt.hash(data, this.bcryptSaltRounds);
  }
}

