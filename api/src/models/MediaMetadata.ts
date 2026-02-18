import mongoose, { Schema, Document } from 'mongoose';

export interface IMediaMetadata extends Document {
  title: string;
  type: 'anime' | 'manga' | 'movie' | 'series' | 'kdrama' | 'jdrama' | 'manhwa' | 'manhua';
  anilistId?: number;
  tmdbId?: number;
  malId?: number;
  description: string;
  genres: string[];
  coverImage: string;
  bannerImage?: string;
  rating: number;
  releaseDate?: Date;
  status: 'ongoing' | 'completed' | 'upcoming' | 'hiatus';
  episodes?: number;
  chapters?: number;
  duration?: number;
  season?: number;
  externalData: any;
  searchKeywords: string[];
  lastUpdated: Date;
  createdAt: Date;
  updatedAt: Date;
}

const MediaMetadataSchema = new Schema<IMediaMetadata>({
  title: { type: String, required: true, index: true },
  type: { 
    type: String, 
    required: true,
    enum: ['anime', 'manga', 'movie', 'series', 'kdrama', 'jdrama', 'manhwa', 'manhua']
  },
  anilistId: { type: Number, unique: true, sparse: true },
  tmdbId: { type: Number, unique: true, sparse: true },
  malId: { type: Number, unique: true, sparse: true },
  description: { type: String, default: '' },
  genres: [{ type: String }],
  coverImage: { type: String, required: true },
  bannerImage: { type: String },
  rating: { type: Number, min: 0, max: 10, default: 0 },
  releaseDate: { type: Date },
  status: { 
    type: String, 
    enum: ['ongoing', 'completed', 'upcoming', 'hiatus'],
    default: 'upcoming'
  },
  episodes: { type: Number },
  chapters: { type: Number },
  duration: { type: Number }, // in minutes
  season: { type: Number },
  externalData: { type: Schema.Types.Mixed },
  searchKeywords: [{ type: String, index: true }],
  lastUpdated: { type: Date, default: Date.now }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Compound index for search
MediaMetadataSchema.index({ title: 'text', description: 'text', searchKeywords: 'text' });
MediaMetadataSchema.index({ type: 1, rating: -1 });
MediaMetadataSchema.index({ releaseDate: -1 });

export const MediaMetadata = mongoose.model<IMediaMetadata>('MediaMetadata', MediaMetadataSchema);
