const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

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

// Google Sheets routes - REMOVED (not needed for solar calculator)

module.exports = router; 