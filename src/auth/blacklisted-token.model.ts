import { index, modelOptions, prop } from '@typegoose/typegoose';

@modelOptions({
  schemaOptions: {
    collection: 'blacklisted_tokens',
    timestamps: true,
  },
})
@index({ exp: 1 }, { expireAfterSeconds: 0 })
export class BlacklistedToken {
  @prop({ required: true, unique: true })
  jti: string;

  @prop({ required: true })
  exp: Date;
}
