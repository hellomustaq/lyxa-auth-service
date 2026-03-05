import { Injectable } from '@nestjs/common';
import { InjectModel } from 'nestjs-typegoose';
import { ReturnModelType } from '@typegoose/typegoose';
import { User } from './user.model';

export interface CreateUserParams {
  name: string;
  email: string;
  passwordHash: string;
  role?: string;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User)
    private readonly userModel: ReturnModelType<typeof User>,
  ) {}

  async createUser(params: CreateUserParams): Promise<User> {
    const { name, email, passwordHash, role } = params;
    const created = await this.userModel.create({
      name,
      email,
      passwordHash,
      role,
    });

    return created;
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.userModel.findOne({ email }).exec();
  }

  async findById(id: string): Promise<User | null> {
    return this.userModel.findById(id).exec();
  }

  async setRefreshTokenHash(
    userId: string,
    refreshTokenHash: string | null,
  ): Promise<void> {
    await this.userModel
      .findByIdAndUpdate(userId, { refreshTokenHash }, { new: false })
      .exec();
  }
}

