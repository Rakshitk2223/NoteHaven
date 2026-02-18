import mongoose, { Schema, Document } from 'mongoose';

export interface IMediaCache extends Document {
  query: string;
  type: string;
  results: any[];
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const MediaCacheSchema = new Schema<IMediaCache>({
  query: { type: String, required: true },
  type: { type: String, required: true },
  results: [{ type: Schema.Types.Mixed }],
  expiresAt: { 
    type: Date, 
    required: true,
    index: { expireAfterSeconds: 0 } // TTL index - auto delete after expiresAt
  }
}, {
  timestamps: true
});

MediaCacheSchema.index({ query: 1, type: 1 }, { unique: true });

export const MediaCache = mongoose.model<IMediaCache>('MediaCache', MediaCacheSchema);
