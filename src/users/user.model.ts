import { modelOptions, prop } from '@typegoose/typegoose';

export enum UserRole {
  USER = 'user',
  ADMIN = 'admin',
}

export class User {
  @prop({ auto: true })
  id: string;

  @prop({ required: true })
  name: string;

  @prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @prop({
    required: true,
    enum: UserRole,
    default: UserRole.USER,
  })
  role: UserRole;

  @prop({ required: true })
  passwordHash: string;

  @prop()
  refreshTokenHash?: string;
}

