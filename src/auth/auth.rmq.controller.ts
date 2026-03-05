import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { AuthService, ValidatedUserPayload } from './auth.service';

@Controller()
export class AuthRmqController {
  constructor(private readonly authService: AuthService) {}

  @MessagePattern('auth.validate-token')
  async validateToken(
    @Payload() data: { token: string },
  ): Promise<ValidatedUserPayload> {
    return this.authService.validateToken(data.token);
  }
}

