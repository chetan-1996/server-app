const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const http = require('http');
const { Server } = require('socket.io');

// Import routes
const configRoutes = require('./routes/config');
const userRoutes = require('./routes/users');
const locationRoutes = require('./routes/locations');
const systemRoutes = require('./routes/system');
const logRoutes = require('./routes/logs');
const calculatorRoutes = require('./routes/calculator');

// Load environment variables
dotenv.config();

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5001;

// CORS Configuration - Enhanced with detailed logging and headers
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      'http://localhost:5173',
      'https://calc.heavengreenenergy.com',
      'https://testcalc.heavengreenenergy.com',
    ];
    
    // Allow requests with no origin (like mobile apps, curl, etc.)
    if (!origin) {
      return callback(null, true);
    }

    // Check if origin matches any allowed origin (string or regex)
    const isAllowed = allowedOrigins.some((allowedOrigin) => {
      if (allowedOrigin instanceof RegExp) {
        return allowedOrigin.test(origin);
      }
      return allowedOrigin === origin;
    });
    
    if (isAllowed) {
      return callback(null, true);
    } else {
      return callback(new Error(`Origin '${origin}' not allowed by CORS`));
    }
  },
  credentials: true, // Important: Allow credentials (cookies, authorization headers)
  optionsSuccessStatus: 200, // Some legacy browsers choke on 204
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  
  exposedHeaders: [
    'Content-Length',
    'x-auth-token',
    'x-requested-with',
    'x-access-token',
    'x-csrf-token'
  ],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'Accept', 
    'x-auth-token',
    'X-Requested-With',
    'Access-Control-Allow-Headers',
    'Origin',
    'X-HTTP-Method-Override'
  ],
  preflightContinue: false
};

// Socket.IO Configuration
const io = new Server(server, {
  cors: corsOptions,
  transports: ['websocket', 'polling']
});

// Middleware
app.use(cors(corsOptions));

// Handle OPTIONS preflight requests explicitly
app.options('*', cors(corsOptions));

// Comprehensive preflight handler
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    res.header('Access-Control-Allow-Origin', req.headers.origin);
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, x-auth-token, X-Requested-With, Access-Control-Allow-Headers, Origin, X-HTTP-Method-Override');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Max-Age', '3600');
    return res.status(200).end();
  }
  next();
});

// Custom middleware to ensure CORS headers are set for all responses
app.use((req, res, next) => {
  const allowedOrigins = [
    'https://calc.heavengreenenergy.com',
    'https://testcalc.heavengreenenergy.com', 
    'http://localhost:5173',
    /\.vercel\.app$/ // ✅ allow Vercel Preview Deployments
  ]; 
  
  const origin = req.headers.origin;
  if (origin) {
    // Check if origin matches any allowed origin (string or regex)
    const isAllowed = allowedOrigins.some((allowedOrigin) => {
      if (allowedOrigin instanceof RegExp) return allowedOrigin.test(origin);
      return allowedOrigin === origin;
    });
    
    if (isAllowed) {
      res.header('Access-Control-Allow-Origin', origin);
    }
  }
  
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, x-auth-token, X-Requested-With, Access-Control-Allow-Headers, Origin, X-HTTP-Method-Override');
  res.header('Access-Control-Allow-Credentials', 'true');
  next();
});

// Increase JSON payload size limit to handle large configurations
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// MongoDB Connection
// Determine database based on environment
const isDevelopment = process.env.NODE_ENV !== 'production';
const MONGODB_URI = process.env.MONGODB_URI || (
  isDevelopment 
    ? 'mongodb+srv://solar:mysolar204@cluster0.ju0lrhv.mongodb.net/testsolar?retryWrites=true&w=majority&appName=Cluster0'  // DEVELOPMENT DATABASE
    : 'mongodb+srv://solar:mysolar204@cluster0.ju0lrhv.mongodb.net/solar?retryWrites=true&w=majority&appName=Cluster0'      // PRODUCTION DATABASE
);

// Global flag to track database availability
global.isDatabaseConnected = false;

// Enhanced MongoDB connection with better error handling and retry logic
const connectToDatabase = async (retryCount = 0) => {
  const maxRetries = 4;
  const retryDelay = 5000; // 5 seconds

  try {
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 15000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 15000,
      maxPoolSize: 5,
      minPoolSize: 1,
      heartbeatFrequencyMS: 30000,
      retryWrites: true,
      retryReads: true,
    });
    
    global.isDatabaseConnected = true;
    
    // Set up connection event handlers
    mongoose.connection.on('error', (err) => {
      global.isDatabaseConnected = false;
    });
    
    mongoose.connection.on('disconnected', () => {
      global.isDatabaseConnected = false;
      
      // Attempt to reconnect after a delay (only if not already retrying)
      if (!mongoose.connection.readyState) {
        setTimeout(() => {
          if (!global.isDatabaseConnected) {
            connectToDatabase(0); // Reset retry count for reconnection
          }
        }, 10000);
      }
    });
    
    mongoose.connection.on('reconnected', () => {
      global.isDatabaseConnected = true;
    });
    
  } catch (err) {
    global.isDatabaseConnected = false;
    
    if (retryCount < maxRetries) {
      setTimeout(() => {
        connectToDatabase(retryCount + 1);
      }, retryDelay);
    }
  }
};

// Start initial connection
connectToDatabase();

// Make io available to routes
app.set('io', io);

// Set default JWT_SECRET if not provided in environment
if (!process.env.JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    console.error('CRITICAL ERROR: JWT_SECRET environment variable must be set in production!');
    process.exit(1);
  }
  process.env.JWT_SECRET = 'solar-calculator-secret-key-2024';
  console.warn('Warning: Using default JWT_SECRET. For production, please set a secure JWT_SECRET in environment variables.');
}

// Routes
app.use('/api/config', configRoutes);
app.use('/api/users', userRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/logs', logRoutes);
app.use('/api/calculator', calculatorRoutes);

// ✅ Serve frontend build (Vite / React)
const path = require('path');

// Serve static files from dist or public folder
app.use(express.static(path.join(__dirname, 'dist')));

// Handle frontend routing (React / Vite)
app.get('*', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
});


// Debug route to check available routes
app.get('/api/debug/routes', (req, res) => {
  const routes = [];
  app._router.stack.forEach((middleware) => {
    if (middleware.route) {
      routes.push({
        path: middleware.route.path,
        methods: Object.keys(middleware.route.methods)
      });
    } else if (middleware.name === 'router') {
      middleware.handle.stack.forEach((handler) => {
        if (handler.route) {
          routes.push({
            path: handler.route.path,
            methods: Object.keys(handler.route.methods)
          });
        }
      });
    }
  });
  res.json({
    message: 'Available routes debug info',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    routes: routes
  });
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  // Join user to their specific room for personalized updates
  socket.on('join-user-room', (userId) => {
    socket.join(`user-${userId}`);
    socket.userId = userId;
    
    // Notify other admin users about new user online
    socket.to('admin-room').emit('user-online', userId);
  });

  // Join admin room for admin-specific updates
  socket.on('join-admin-room', () => {
    socket.join('admin-room');
    socket.isAdmin = true;
  });

  // Handle pricing config update emissions
  socket.on('pricing-config-update', (config) => {
    if (socket.isAdmin) {
      socket.broadcast.emit('pricing-config-updated', config);
    }
  });

  // Handle calculator usage emissions
  socket.on('calculator-usage', (logData) => {
    socket.to('admin-room').emit('new-calculator-log', logData);
  });

  // Handle user login emissions
  socket.on('user-login', (loginData) => {
    socket.to('admin-room').emit('new-login-log', loginData);
  });

  // Handle user status change emissions
  socket.on('user-status-change', (data) => {
    if (socket.isAdmin) {
      socket.to(`user-${data.userId}`).emit('user-status-changed', data);
      socket.to('admin-room').emit('user-status-changed', data);
    }
  });

  // Handle user disconnect
  socket.on('disconnect', () => {
    if (socket.userId) {
      // Notify admin users about user going offline
      socket.to('admin-room').emit('user-offline', socket.userId);
    }
  });
});

// Home route
app.get('/', (req, res) => {
  res.send('Solar Calculator API is running with Socket.IO');
});

// Test CORS endpoint
app.get('/api/test-cors', (req, res) => {
  res.json({ 
    message: 'CORS is working correctly',
    origin: req.headers.origin,
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV === 'production' ? 'production' : 'development'
  });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  const dbStatus = mongoose.connection.readyState;
  const dbStatusText = {
    0: 'Disconnected',
    1: 'Connected',
    2: 'Connecting',
    3: 'Disconnecting'
  };

  res.json({
    status: 'Server is running',
    database: {
      connected: global.isDatabaseConnected,
      readyState: dbStatus,
      readyStateText: dbStatusText[dbStatus] || 'Unknown',
      host: mongoose.connection.host,
      name: mongoose.connection.name
    },
    server: {
      port: PORT,
      environment: process.env.NODE_ENV || 'development',
      uptime: process.uptime(),
      memory: process.memoryUsage()
    },
    timestamp: new Date().toISOString()
  });
});

// Start server
server.listen(PORT, () => {
}); 