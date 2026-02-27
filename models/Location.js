const mongoose = require('mongoose');

const locationSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    validate: {
      validator: function(v) {
        // Only allow alphanumeric and hyphens, no spaces
        return /^[a-z0-9-]+$/.test(v);
      },
      message: 'Location name can only contain lowercase letters, numbers, and hyphens'
    }
  },
  displayName: {
    type: String,
    required: true,
    trim: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

// Index for faster queries
locationSchema.index({ name: 1 });

module.exports = mongoose.model('Location', locationSchema);