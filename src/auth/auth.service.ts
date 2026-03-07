import {
  BadRequestException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ClientProxy } from '@nestjs/microservices';
import { InjectModel } from 'nestjs-typegoose';
import { ReturnModelType } from '@typegoose/typegoose';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { UsersService } from '../users/users.service';
import { User, UserRole } from '../users/user.model';
import { BlacklistedToken } from './blacklisted-token.model';

function getUserId(user: User): string {
  const doc = user as User & { _id?: { toString(): string } };
  return doc._id?.toString?.() ?? (user as any).id ?? '';
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface TokenPayload {
  sub: string;
  email: string;
  role: UserRole;
  jti?: string;
  exp?: number;
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
    @Inject('AUTH_USER_EVENTS')
    private readonly userEventsClient: ClientProxy,
    @InjectModel(BlacklistedToken)
    private readonly blacklistedTokenModel: ReturnModelType<typeof BlacklistedToken>,
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
    const userId = getUserId(user);
    await this.usersService.setRefreshTokenHash(userId, refreshTokenHash);

    this.userEventsClient.emit('user.created', {
      id: userId,
      email: user.email,
      name: user.name,
      role: user.role,
    });

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
    await this.usersService.setRefreshTokenHash(getUserId(user), refreshTokenHash);

    return { user, tokens };
  }

  async refreshTokens(params: {
    refreshToken: string;
  }): Promise<{ user: User; tokens: AuthTokens }> {
    const refreshSecret = this.configService.get<string>('JWT_REFRESH_SECRET');
    if (!refreshSecret) {
      throw new Error('JWT_REFRESH_SECRET is not configured');
    }

    const token = params.refreshToken?.trim?.() ?? '';
    if (!token) {
      throw new UnauthorizedException('Refresh token is required');
    }

    let payload: TokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<TokenPayload>(token, {
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
      token,
      user.refreshTokenHash,
    );
    if (!refreshMatches) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokens = await this.getTokens(user);
    const newRefreshHash = await this.hashData(tokens.refreshToken);
    await this.usersService.setRefreshTokenHash(getUserId(user), newRefreshHash);

    return { user, tokens };
  }

  async logout(params: { refreshToken: string }): Promise<void> {
    const refreshSecret = this.configService.get<string>('JWT_REFRESH_SECRET');
    if (!refreshSecret) {
      throw new Error('JWT_REFRESH_SECRET is not configured');
    }

    const token = params.refreshToken?.trim?.() ?? '';
    if (!token) {
      throw new UnauthorizedException('Refresh token is required');
    }

    let payload: TokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<TokenPayload>(token, {
        secret: refreshSecret,
      });
    } catch (err) {
      const msg =
        err?.name === 'TokenExpiredError'
          ? 'Refresh token expired'
          : 'Invalid refresh token';
      throw new UnauthorizedException(msg);
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    await this.usersService.setRefreshTokenHash(getUserId(user), null);
  }

  async logoutByAccessToken(accessToken: string): Promise<void> {
    const accessSecret = this.configService.get<string>('JWT_ACCESS_SECRET');
    if (!accessSecret) {
      throw new Error('JWT_ACCESS_SECRET is not configured');
    }

    let payload: TokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<TokenPayload>(accessToken, {
        secret: accessSecret,
      });
    } catch (err) {
      const msg =
        err?.name === 'TokenExpiredError'
          ? 'Access token expired'
          : 'Invalid access token';
      throw new UnauthorizedException(msg);
    }

    if (payload.jti) {
      const expDate = payload.exp
        ? new Date(payload.exp * 1000)
        : new Date(Date.now() + 24 * 60 * 60 * 1000);
      await this.blacklistedTokenModel.create({ jti: payload.jti, exp: expDate });
    }

    await this.usersService.setRefreshTokenHash(payload.sub, null);
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
    } catch (err) {
      const msg =
        err?.name === 'TokenExpiredError'
          ? 'Access token expired'
          : 'Invalid access token';
      throw new UnauthorizedException(msg);
    }

    if (payload.jti) {
      const found = await this.blacklistedTokenModel.findOne({ jti: payload.jti }).exec();
      if (found) {
        throw new UnauthorizedException('Access token has been revoked');
      }
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('Invalid access token');
    }

    return {
      userId: getUserId(user),
      email: user.email,
      role: user.role,
    };
  }

  private async getTokens(user: User): Promise<AuthTokens> {
    const userId = getUserId(user);
    const basePayload = {
      sub: userId,
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
      this.jwtService.signAsync(
        { ...basePayload, jti: randomUUID() },
        {
          secret: accessSecret,
          expiresIn: accessExpiresIn,
        },
      ),
      this.jwtService.signAsync(basePayload, {
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

