const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const mongoose = require('mongoose');
const User = require('../models/User');
const Location = require('../models/Location');
const LoginLog = require('../models/LoginLog');
const CalculatorLog = require('../models/CalculatorLog');

// Database connection check utility
const checkDatabaseConnection = () => {
  return global.isDatabaseConnected && mongoose.connection.readyState === 1;
};

// Database operation wrapper with timeout and error handling
const dbOperation = async (operation, timeoutMs = 5000) => {
  if (!checkDatabaseConnection()) {
    throw new Error('Database not connected');
  }
  
  return Promise.race([
    operation(),
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Database operation timeout')), timeoutMs)
    )
  ]);
};

// Custom CORS configuration for user routes
const corsOptions = {
  origin: process.env.NODE_ENV === 'production'
    ? ['https://calc.heavengreenenergy.com']
    : ['http://localhost:3000', 'http://localhost:5173'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  credentials: true,
  optionsSuccessStatus: 200
};

// Database health check endpoint
router.get('/health', async (req, res) => {
  try {
    const isConnected = checkDatabaseConnection();
    const connectionState = mongoose.connection.readyState;
    const stateNames = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };
    
    if (isConnected) {
      // Try a simple query to ensure database is actually working
      const userCount = await User.countDocuments().maxTimeMS(3000);
      res.json({
        status: 'healthy',
        database: 'connected',
        connectionState: stateNames[connectionState],
        userCount,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(503).json({
        status: 'unhealthy',
        database: 'disconnected',
        connectionState: stateNames[connectionState],
        error: 'Database not available',
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      database: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get all users (for admin dashboard)
router.get('/', async (req, res) => {
  try {
    const users = await dbOperation(() => 
      User.find()
        .sort({ createdAt: -1 })
        .select('-password')
    );
    res.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ 
      message: 'Error fetching users', 
      error: error.message,
      dbConnected: checkDatabaseConnection()
    });
  }
});

// Register new user (request access) - This is now disabled as only admin can create users
router.post('/register', async (req, res) => {
  return res.status(403).json({ 
    message: 'User registration is disabled. Only administrators can create user accounts.' 
  });
});

// User login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    
    // Ensure JWT_SECRET is set
    if (!process.env.JWT_SECRET) {
      process.env.JWT_SECRET = 'solar-calculator-secret-key-2024';
    }
    
    // Check if user exists
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Only allow users created by admin to login
    if (!user.createdByAdmin && !user.isAdmin()) {
      return res.status(403).json({ 
        message: 'Access denied. Only users created by administrator can log in.' 
      });
    }
    
    // Check password
    const isMatch = await bcrypt.compare(password, user.password);
    
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }


    // Update login count and last login date
    user.loginCount = (user.loginCount || 0) + 1;
    user.lastLoginDate = new Date();
    await user.save();

    // Log the login
    const loginLog = new LoginLog({
      userId: user._id,
      username: user.username,
      name: user.name || user.username,
      loginDate: new Date(),
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      role: user.role
    });
    await loginLog.save();

    // Emit real-time login event
    const io = req.app.get('io');
    if (io) {
      io.to('admin-room').emit('new-login-log', {
        userId: user.username,
        name: user.name || user.username,
        loginDate: new Date(),
        timestamp: Date.now(),
        role: user.role
      });
    }

    
    // Create JWT token
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    
    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        name: user.name || user.username,
        role: user.role,
        // Do not silently fall back to surat if locations are missing;
        // let the client handle empty/invalid state visibly.
        allowedLocations: Array.isArray(user.allowedLocations)
          ? user.allowedLocations
          : []
      },
      isApproved: true
    });
  } catch (error) {
    console.error('   Error stack:', error.stack);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Admin login
router.post('/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password are required' });
    }

    // Find user by username
    const user = await User.findOne({ username });
    
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    
    // Check password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Verify admin role
    if (user.role !== 'Admin') {
      return res.status(403).json({ message: 'Access denied. Admin privileges required.' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { 
        id: user._id,
        role: user.role,
        username: user.username
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Update login count and last login
    user.loginCount = (user.loginCount || 0) + 1;
    user.lastLogin = new Date();
    await user.save();

    // Log the admin login (same as regular login)
    const loginLog = new LoginLog({
      userId: user._id,
      username: user.username,
      name: user.name || user.username,
      loginDate: new Date(),
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      role: user.role
    });
    await loginLog.save();

    // Emit real-time login event
    const io = req.app.get('io');
    if (io) {
      io.to('admin-room').emit('new-login-log', {
        userId: user.username,
        name: user.name || user.username,
        loginDate: new Date(),
        timestamp: Date.now(),
        role: user.role
      });
    }
    
    res.json({
      message: 'Admin login successful',
      token,
      user: {
        id: user._id,
        role: user.role,
        username: user.username,
        name: user.name || user.username,
        loginCount: user.loginCount,
        lastLogin: user.lastLogin
      }
    });
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update user allowed locations
router.patch('/:id/locations', async (req, res) => {
  try {
    if (!checkDatabaseConnection()) {
      return res.status(503).json({ message: 'Database connection not available' });
    }

    const { allowedLocations } = req.body;
    
    if (!Array.isArray(allowedLocations) || allowedLocations.length === 0) {
      return res.status(400).json({ message: 'At least one location must be selected' });
    }
    
    // Validate locations against Location collection
    const validLocations = await dbOperation(() => 
      Location.find({ name: { $in: allowedLocations } }).select('name')
    );
    const validLocationNames = validLocations.map(loc => loc.name);
    
    const invalidLocations = allowedLocations.filter(loc => !validLocationNames.includes(loc));
    if (invalidLocations.length > 0) {
      return res.status(400).json({ 
        message: `Invalid locations: ${invalidLocations.join(', ')}` 
      });
    }
    
    const updatedUser = await dbOperation(() => 
      User.findByIdAndUpdate(
      req.params.id,
      { allowedLocations },
      { new: true }
      ).select('-password')
    );
    
    if (!updatedUser) {
      console.error('❌ User not found for ID:', req.params.id);
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Emit real-time update to the user about their location access changes
    const io = req.app.get('io');
    if (io) {
      // Broadcast to all connected clients so the user receives the update
      io.emit('user-updated', {
        _id: updatedUser._id,
        id: updatedUser.id,
        username: updatedUser.username,
        allowedLocations: updatedUser.allowedLocations
      });
    } else {
      console.error('❌ Socket.IO instance not found - event NOT emitted');
    }
    
    res.json(updatedUser);
  } catch (error) {
    console.error('Error updating user locations:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Create user (for admin panel)
router.post('/create', async (req, res) => {
  try {
    
    const { name, username, password, role = 'User', company, email, status, allowedLocations } = req.body;
    
    // Validate role
    const validRoles = ['Admin', 'User', 'ChannelPartner', 'ChannelPartnerBDM', 'BusinessAssociate'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ message: 'Invalid role specified' });
    }
    
    // Check if username already exists
    let user = await User.findOne({ username });
    if (user) {
      return res.status(400).json({ message: 'Username already exists' });
    }
    
    // Validate allowedLocations against Location collection
    let userLocations = ['surat']; // Default to surat
    if (allowedLocations && Array.isArray(allowedLocations) && allowedLocations.length > 0) {
      try {
        const validLocations = await dbOperation(() => 
          Location.find({ name: { $in: allowedLocations } }).select('name')
        );
        const validLocationNames = validLocations.map(loc => loc.name);
        userLocations = allowedLocations.filter(loc => validLocationNames.includes(loc));
        
        if (userLocations.length === 0) {
          // If no valid locations, get default location
          const defaultLocation = await dbOperation(() => 
            Location.findOne({}).select('name').sort({ createdAt: 1 })
          );
          userLocations = defaultLocation ? [defaultLocation.name] : ['surat'];
        }
      } catch (error) {
        console.error('Error validating locations:', error);
        // Fallback to default if validation fails
        userLocations = ['surat'];
      }
    } else {
      // If no locations provided, get default location
      try {
        const defaultLocation = await dbOperation(() => 
          Location.findOne({}).select('name').sort({ createdAt: 1 })
        );
        userLocations = defaultLocation ? [defaultLocation.name] : ['surat'];
      } catch (error) {
        console.error('Error getting default location:', error);
        userLocations = ['surat'];
      }
    }
    
    // Create new user
    // All users get automatic approval and calculator access
    const userStatus = 'approved';
    
    user = new User({
      name,
      username,
      password,
      role,
      company,
      email,
      status: userStatus,
      createdByAdmin: true,
      allowedLocations: userLocations,
      createdAt: new Date()
    });
    
    const savedUser = await user.save();
    
    // Emit real-time update to admin dashboard
    const io = req.app.get('io');
    if (io) {
      io.to('admin-room').emit('user-created', {
        id: savedUser.id,
        username: savedUser.username,
        name: savedUser.name,
        role: savedUser.role,
        company: savedUser.company,
        email: savedUser.email,
        status: savedUser.status,
        createdAt: savedUser.createdAt,
        timestamp: Date.now()
      });
    } else {
    }
    
    
    res.json({
      message: 'User created successfully',
      user: {
        id: savedUser.id,
        username: savedUser.username,
        name: savedUser.name,
        role: savedUser.role,
        company: savedUser.company,
        email: savedUser.email,
        status: savedUser.status,
        createdAt: savedUser.createdAt
      }
    });
  } catch (error) {
    console.error('=== USER CREATION ERROR ===');
    console.error('Error creating user:', error);
    console.error('Stack trace:', error.stack);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Handle preflight requests for DELETE
router.options('/:id', cors(corsOptions));

// Delete user
router.delete('/:id', cors(corsOptions), async (req, res) => {
  try {
    
    // Validate the ID format
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid user ID format' });
    }
    
    const user = await User.findById(req.params.id);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Note: Self-deletion prevention is handled on the frontend
    // The frontend ensures the current admin cannot delete themselves
    
    // Protect System Administrator from deletion - ensure there's always at least one system admin
    if (user.username === 'HeavenGreen' && user.isAdmin()) {
      return res.status(400).json({ message: 'Cannot delete System Administrator account. This account is protected to ensure system access.' });
    }
    
          // Allow deletion of both direct sales users and admin users (except system admin and self)
    const deleteResult = await User.findByIdAndDelete(req.params.id);
    
    const userType = user.isAdmin() ? 'admin user' : 'user';
    
    res.json({ 
      message: `${userType.charAt(0).toUpperCase() + userType.slice(1)} deleted successfully`,
      deletedUser: {
        id: user._id,
        username: user.username,
        isAdmin: user.isAdmin()
      }
    });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Change password
router.post('/change-password', async (req, res) => {
  try {
    const { userId, currentPassword, newPassword } = req.body;
    
    // Validation
    if (!userId || !currentPassword || !newPassword) {
      return res.status(400).json({ message: 'User ID, current password, and new password are required' });
    }
    
    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters long' });
    }
    
    // Find user
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Verify current password
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    
    if (!isMatch) {
      return res.status(400).json({ message: 'Current password is incorrect' });
    }
    
    // Update password (the pre-save hook will handle hashing)
    user.password = newPassword;
    user.passwordUpdatedDate = new Date();
    await user.save();
    
    res.json({ 
      message: 'Password changed successfully',
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        passwordUpdatedDate: user.passwordUpdatedDate
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Admin reset user password
router.post('/:userId/reset-password', async (req, res) => {
  try {
    const { userId } = req.params;
    const { newPassword } = req.body;
    
    // Validation
    if (!newPassword) {
      return res.status(400).json({ message: 'New password is required' });
    }
    
    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters long' });
    }
    
    // Find user
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Update password (the pre-save hook will handle hashing)
    user.password = newPassword;
    user.passwordUpdatedDate = new Date();
    await user.save();
    
    res.json({ 
      message: 'Password reset successfully',
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        passwordUpdatedDate: user.passwordUpdatedDate
      }
    });
  } catch (error) {
    console.error('Error resetting password:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Admin get user password
router.get('/:userId/password', async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Find user
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Return the plain text password (stored in plainTextPassword field)
    res.json({ 
      password: user.plainTextPassword || 'Password not available'
    });
  } catch (error) {
    console.error('Error getting password:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Log calculator usage
router.post('/log-calculator', async (req, res) => {
  try {
    const { userId, inputData, results } = req.body;
    
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const calculatorLog = new CalculatorLog({
      userId: user._id,
      username: user.username,
      name: user.name,
      calculationDate: new Date(),
      inputData,
      results
    });
    
    await calculatorLog.save();

    // Emit real-time calculator log event
    const io = req.app.get('io');
    if (io) {
      io.to('admin-room').emit('new-calculator-log', {
        userId: user.username,
        name: user.name,
        calculationDate: new Date(),
        inputData,
        results,
        timestamp: Date.now()
      });
    }


    res.json({ message: 'Calculator usage logged successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Initialize admin user if none exists
router.post('/init-admin', async (req, res) => {
  try {
    // Check if any admin user exists
    const adminExists = await User.findOne({ role: 'Admin' });
    
    if (adminExists) {
      return res.status(400).json({ message: 'Admin user already exists' });
    }

    // Create default admin user
    const adminUser = new User({
      name: 'System Administrator',
      username: 'HeavenGreen',
      password: 'Heaven@Green!204', // Updated secure password
      role: 'Admin',
      status: 'approved',
      createdByAdmin: true
    });

    await adminUser.save();

    res.json({ 
      message: 'Admin user initialized successfully',
      user: {
        id: adminUser.id,
        username: adminUser.username,
        name: adminUser.name,
        role: adminUser.role
      }
    });
  } catch (error) {
    console.error('Error initializing admin:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get admin status
router.get('/check-admin', async (req, res) => {
  try {
    const adminCount = await User.countDocuments({ role: 'Admin' });
    res.json({ 
      hasAdmin: adminCount > 0,
      adminCount
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Reset admin user (for troubleshooting)
router.post('/reset-admin', cors(corsOptions), async (req, res) => {
  try {
    // Delete existing HeavenGreen admin user
    await User.deleteMany({ username: 'HeavenGreen' });

    // Create new admin user
    const adminUser = new User({
      name: 'System Administrator',
      username: 'HeavenGreen',
      password: 'Heaven@Green!204',
      role: 'Admin',
      status: 'approved',
      createdByAdmin: true
    });

    await adminUser.save();

    res.json({ 
      message: 'Admin user reset successfully',
      admin: {
        id: adminUser.id,
        username: adminUser.username,
        name: adminUser.name
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get users by role
router.get('/by-role/:role', async (req, res) => {
  try {
    const { role } = req.params;
    
    // Check database connection first
    if (!checkDatabaseConnection()) {
      return res.json({
        users: [],
        count: 0,
        role,
        error: 'Database not connected'
      });
    }
    
    let users = [];
    
    // Special case for "All" to get all users
    if (role === 'All') {
      users = await dbOperation(() => 
        User.find()
          .sort({ createdAt: -1 })
          .select('-password')
      );
      
    } else if (role === 'User' || role === 'SimpleUser') {
      // Special handling for direct sales users - fetch users with role 'User', 'SimpleUser', or undefined role who aren't admins
      users = await dbOperation(() => 
        User.find({
          $and: [
            { 
              $or: [
                { role: 'User' },
                { role: 'SimpleUser' },
                { role: { $exists: false } },
                { role: null }
              ]
            },
            { isAdmin: { $ne: true } },
            { role: { $ne: 'Admin' } }
          ]
        })
          .sort({ createdAt: -1 })
          .select('-password')
      );
        
    } else {
      users = await dbOperation(() => 
        User.find({ role })
          .sort({ createdAt: -1 })
          .select('-password')
      );
    }
    
    // Handle legacy isAdmin field for backward compatibility
    if (role === 'Admin') {
      try {
        // Also include users with isAdmin = true
        const adminsByFlag = await dbOperation(() => 
          User.find({ isAdmin: true, role: { $ne: 'Admin' } })
            .sort({ createdAt: -1 })
            .select('-password')
        );
        
        // Combine lists, avoiding duplicates
        const adminIds = new Set(users.map(u => u._id.toString()));
        const additionalAdmins = adminsByFlag.filter(u => !adminIds.has(u._id.toString()));
        
        if (additionalAdmins.length > 0) {
          users = [...users, ...additionalAdmins];
          // Re-sort after combining lists
          users = users.sort((a, b) => {
            if (a.createdAt && b.createdAt) {
              return new Date(b.createdAt) - new Date(a.createdAt);
            }
            return 0;
          });
        }
      } catch (adminError) {
        console.warn('Error fetching legacy admin users:', adminError.message);
        // Continue with existing users list
      }
    }
    
    // Log the first user's createdAt field for debugging
    if (users.length > 0) {
      // Sample user check
    }
    res.json({
      users,
      count: users.length,
      role
    });
  } catch (error) {
    console.error('Error fetching users by role:', error);
    
    // Return empty list instead of error to prevent frontend crashes
    res.json({
      users: [],
      count: 0,
      role: req.params.role,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Check user role and basic details (used by frontend to refresh user data)
router.get('/check-role/:username', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({ 
      username: user.username,
      role: user.role,
      status: user.status,
      // Expose identifiers and allowed locations so frontend can sync state
      _id: user._id,
      id: user.id,
      allowedLocations: user.allowedLocations || []
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update user to Admin role
router.post('/update-to-admin/:username', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.role = 'Admin';
    await user.save();

    res.json({ 
      message: 'User updated to Admin role successfully',
      user: {
        username: user.username,
        role: user.role,
        status: user.status
      }
    });
  } catch (error) {
    console.error('Error updating user role:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;
