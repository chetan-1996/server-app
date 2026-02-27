const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Helper function to verify token
const verifyToken = async (token) => {
  try {
    if (!token) {
      throw new Error('No token provided');
    }
    
    // Try with JWT secret from environment or default
    const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret';
    const decoded = jwt.verify(token, JWT_SECRET);
    
    if (!decoded) {
      throw new Error('Invalid token: Could not decode');
    }
    return decoded;
  } catch (error) {
    console.error('Token verification failed:', error.message);
    throw new Error('Invalid token: ' + error.message);
  }
};

const auth = async (req, res, next) => {
  try {
    // Get token from header or query parameter
    let token = req.header('x-auth-token') || 
               req.header('Authorization')?.replace('Bearer ', '') ||
               req.query.token;
    
    // Check if no token
    if (!token) {
      return res.status(401).json({ 
        success: false,
        message: 'No authentication token, authorization denied' 
      });
    }

    try {
      // Verify token
      const decoded = await verifyToken(token);
      
      // Check if user exists
      const user = await User.findById(decoded.userId || decoded.id || decoded._id);
      if (!user) {
        return res.status(401).json({ 
          success: false,
          message: 'User not found' 
        });
      }

      // Add user to request object
      req.user = user;
      next();
    } catch (err) {
      console.error('Token verification error:', err.message);
      return res.status(401).json({ 
        success: false,
        message: 'Token is not valid',
        error: err.message
      });
    }
  } catch (err) {
    console.error('Auth middleware error:', err);
    res.status(500).json({ 
      success: false,
      message: 'Server error during authentication',
      error: err.message 
    });
  }
};

const adminAuth = async (req, res, next) => {
  try {
    // Get token from header or query parameter
    let token = req.header('x-auth-token') || 
               req.header('Authorization')?.replace('Bearer ', '') ||
               req.query.token;
    
    // Check if no token
    if (!token) {
      return res.status(401).json({ 
        success: false,
        message: 'No authentication token, admin access denied' 
      });
    }

    try {
      // Verify token
      const decoded = await verifyToken(token);
      
      // Check if user exists and is admin
      const user = await User.findById(decoded.userId || decoded.id || decoded._id);
      if (!user) {
        return res.status(401).json({ 
          success: false,
          message: 'Admin user not found' 
        });
      }

      // Check if user is admin (case-insensitive check)
      if (!user.role || user.role.toLowerCase() !== 'admin') {
        return res.status(403).json({ 
          success: false,
          message: 'Admin privileges required' 
        });
      }

      // Add user to request object
      req.user = user;
      next();
    } catch (err) {
      console.error('Admin token verification error:', err.message);
      return res.status(401).json({ 
        success: false,
        message: 'Invalid or expired token',
        error: err.message
      });
    }
  } catch (err) {
    console.error('Admin auth middleware error:', err);
    res.status(500).json({ 
      success: false,
      message: 'Server error during admin authentication',
      error: err.message 
    });
  }
};

module.exports = { auth, adminAuth };
