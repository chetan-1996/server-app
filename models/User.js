const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  password: {
    type: String,
    required: true
  },
  plainTextPassword: {
    type: String,
    required: false
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  role: {
    type: String,
    enum: ['Admin', 'User', 'ChannelPartner', 'ChannelPartnerBDM', 'BusinessAssociate'],
    required: true,
    default: 'User'
  },
  createdByAdmin: {
    type: Boolean,
    default: false
  },
  loginCount: {
    type: Number,
    default: 0
  },
  lastLogin: {
    type: Date
  },
  company: {
    type: String,
    trim: true
  },
  email: {
    type: String,
    trim: true
  },
  allowedLocations: {
    type: [String],
    default: ['surat']
    // Note: Validation is done at the route level against Location collection
    // Schema validation removed to avoid async validator issues
  }
}, { timestamps: true });

// Hash password before saving
userSchema.pre('save', async function(next) {
    if (!this.isModified('password')) return next();
    
    try {
      // Store the plain text password before hashing
      this.plainTextPassword = this.password;
      
      const salt = await bcrypt.genSalt(10);
      this.password = await bcrypt.hash(this.password, salt);
      next();
  } catch (error) {
    next(error);
  }
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  try {
    return await bcrypt.compare(candidatePassword, this.password);
  } catch (error) {
    throw error;
  }
};

// Helper method to check if user is admin
userSchema.methods.isAdmin = function() {
  return this.role === 'Admin';
};

// Helper method to get user type
userSchema.methods.getUserType = function() {
  return this.role;
};

module.exports = mongoose.model('User', userSchema);