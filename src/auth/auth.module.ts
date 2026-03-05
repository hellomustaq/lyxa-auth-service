import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { UsersModule } from '../users/users.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { AuthRmqController } from './auth.rmq.controller';

@Module({
  imports: [
    ConfigModule,
    UsersModule,
    ClientsModule.registerAsync([
      {
        name: 'AUTH_USER_EVENTS',
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.RMQ,
          options: {
            urls: [
              configService.get('RABBITMQ_URL') ||
                'amqp://guest:guest@localhost:5672',
            ],
            queue:
              configService.get('RABBITMQ_AUTH_QUEUE') ||
              'auth-service-user-events-queue',
            queueOptions: {
              durable: false,
            },
          },
        }),
      },
    ]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_ACCESS_SECRET') || 'access-secret',
      }),
    }),
  ],
  controllers: [AuthController, AuthRmqController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}

