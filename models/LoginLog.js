const mongoose = require('mongoose');

const LoginLogSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  username: {
    type: String,
    required: true
  },
  name: {
    type: String,
    required: true
  },
  role: {
    type: String,
    enum: ['Admin', 'User', 'ChannelPartner', 'ChannelPartnerBDM', 'BusinessAssociate'],
    required: true
  },
  loginDate: {
    type: Date,
    default: Date.now
  },
  ipAddress: {
    type: String
  },
  userAgent: {
    type: String
  },
  syncedToSheet: {
    type: Boolean,
    default: false
  }
});

module.exports = mongoose.model('LoginLog', LoginLogSchema); 