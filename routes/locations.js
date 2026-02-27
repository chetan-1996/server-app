const express = require('express');
const router = express.Router();
const Location = require('../models/Location');
const User = require('../models/User');
const PricingConfig = require('../models/PricingConfig');

// Helper function to check database connection
const checkDatabaseConnection = () => {
  return global.isDatabaseConnected || false;
};

// Helper function for database operations with timeout
const dbOperation = async (operation, timeout = 5000) => {
  if (!checkDatabaseConnection()) {
    throw new Error('Database connection not available');
  }
  
  return new Promise(async (resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Database operation timeout'));
    }, timeout);
    
    try {
      const result = await operation();
      clearTimeout(timer);
      resolve(result);
    } catch (error) {
      clearTimeout(timer);
      reject(error);
    }
  });
};

// Get all locations
router.get('/', async (req, res) => {
  try {
    if (!checkDatabaseConnection()) {
      return res.status(503).json({ message: 'Database connection not available' });
    }
    
    const locations = await dbOperation(() => 
      Location.find({}).sort({ displayName: 1 })
    );
    
    res.json(locations);
  } catch (error) {
    console.error('Error fetching locations:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get location usage details (users assigned)
router.get('/:id/usage', async (req, res) => {
  try {
    if (!checkDatabaseConnection()) {
      return res.status(503).json({ message: 'Database connection not available' });
    }

    const location = await dbOperation(() => Location.findById(req.params.id));
    if (!location) {
      return res.status(404).json({ message: 'Location not found' });
    }

    const usersWithLocation = await dbOperation(() => 
      User.find({ allowedLocations: location.name }).select('username name allowedLocations')
    );

    const pricingConfigCount = await dbOperation(() => 
      PricingConfig.countDocuments({ location: location.name })
    );

    res.json({
      location: {
        id: location._id,
        name: location.name,
        displayName: location.displayName
      },
      userCount: usersWithLocation.length,
      users: usersWithLocation.map(user => ({
        id: user._id,
        username: user.username,
        name: user.name || user.username,
        allowedLocations: user.allowedLocations
      })),
      pricingConfigCount,
    });
  } catch (error) {
    console.error('Error fetching location usage:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get single location by ID
router.get('/:id', async (req, res) => {
  try {
    if (!checkDatabaseConnection()) {
      return res.status(503).json({ message: 'Database connection not available' });
    }

    const location = await dbOperation(() => Location.findById(req.params.id));
    
    if (!location) {
      return res.status(404).json({ message: 'Location not found' });
    }
    
    res.json(location);
  } catch (error) {
    console.error('Error fetching location:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get location by name
router.get('/name/:name', async (req, res) => {
  try {
    if (!checkDatabaseConnection()) {
      return res.status(503).json({ message: 'Database connection not available' });
    }

    const location = await dbOperation(() => 
      Location.findOne({ name: req.params.name.toLowerCase() })
    );
    
    if (!location) {
      return res.status(404).json({ message: 'Location not found' });
    }
    
    res.json(location);
  } catch (error) {
    console.error('Error fetching location by name:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Create new location
router.post('/', async (req, res) => {
  try {
    if (!checkDatabaseConnection()) {
      return res.status(503).json({ message: 'Database connection not available' });
    }

    const { name, displayName, copyFromLocationId } = req.body;
    
    // Validate required fields
    if (!name || !displayName) {
      return res.status(400).json({ message: 'Name and displayName are required' });
    }
    
    // Check if location with same name already exists
    const existingLocation = await dbOperation(() => 
      Location.findOne({ name: name.toLowerCase() })
    );
    
    if (existingLocation) {
      return res.status(400).json({ message: 'Location with this name already exists' });
    }
    
    // Create new location
    const location = new Location({
      name: name.toLowerCase(),
      displayName: displayName.trim()
    });
    
    const savedLocation = await dbOperation(() => location.save());

    let copiedFrom = null;

    if (copyFromLocationId) {
      const sourceLocation = await dbOperation(() => Location.findById(copyFromLocationId));

      if (!sourceLocation) {
        return res.status(400).json({ message: 'Source location not found for copying settings.' });
      }

      const sourceConfig = await dbOperation(() => PricingConfig.findOne({ location: sourceLocation.name }));

      if (!sourceConfig) {
        return res.status(400).json({ message: `No pricing configuration found for source location: ${sourceLocation.displayName || sourceLocation.name}` });
      }

      const {
        _id,
        createdAt,
        updatedAt,
        __v,
        location: _ignoredLocation,
        ...configData
      } = sourceConfig.toObject({ depopulate: true });

      const newConfig = new PricingConfig({
        ...configData,
        location: savedLocation.name,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      await dbOperation(() => newConfig.save());
      copiedFrom = {
        id: sourceLocation._id,
        name: sourceLocation.name,
        displayName: sourceLocation.displayName
      };
    }
    
    res.status(201).json({
      location: savedLocation,
      copiedFrom
    });
  } catch (error) {
    console.error('Error creating location:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: 'Validation error', error: error.message });
    }
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update location
router.put('/:id', async (req, res) => {
  try {
    if (!checkDatabaseConnection()) {
      return res.status(503).json({ message: 'Database connection not available' });
    }

    const { name, displayName } = req.body;
    
    const location = await dbOperation(() => Location.findById(req.params.id));
    
    if (!location) {
      return res.status(404).json({ message: 'Location not found' });
    }
    
    // If name is being changed, check if new name already exists
    if (name && name.toLowerCase() !== location.name) {
      const existingLocation = await dbOperation(() => 
        Location.findOne({ name: name.toLowerCase(), _id: { $ne: req.params.id } })
      );
      
      if (existingLocation) {
        return res.status(400).json({ message: 'Location with this name already exists' });
      }
      
      // Check if location is being used in users or pricing configs
      const usersWithLocation = await dbOperation(() => 
        User.countDocuments({ allowedLocations: location.name })
      );
      
      const pricingConfigsWithLocation = await dbOperation(() => 
        PricingConfig.countDocuments({ location: location.name })
      );
      
      if (usersWithLocation > 0 || pricingConfigsWithLocation > 0) {
        return res.status(400).json({ 
          message: 'Cannot change location name. Location is in use by users or pricing configs. Please delete and create a new location instead.' 
        });
      }
      
      location.name = name.toLowerCase();
    }
    
    if (displayName !== undefined) {
      location.displayName = displayName.trim();
    }
    
    location.updatedAt = Date.now();
    
    const updatedLocation = await dbOperation(() => location.save());
    
    res.json(updatedLocation);
  } catch (error) {
    console.error('Error updating location:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: 'Validation error', error: error.message });
    }
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Delete location (only if not in use)
router.delete('/:id', async (req, res) => {
  try {
    if (!checkDatabaseConnection()) {
      return res.status(503).json({ message: 'Database connection not available' });
    }

    const location = await dbOperation(() => Location.findById(req.params.id));
    
    if (!location) {
      return res.status(404).json({ message: 'Location not found' });
    }
    
    // Check if location is being used by users
    const usersWithLocation = await dbOperation(() => 
      User.countDocuments({ allowedLocations: location.name })
    );
    
    const pricingConfigsForLocation = await dbOperation(() => 
      PricingConfig.find({ location: location.name }).select('location')
    );
    
    const usersWithLocationRecords = await dbOperation(() =>
      User.find({ allowedLocations: location.name }).select('username name allowedLocations')
    );

    let impactedUsersResponse = [];

    if (usersWithLocationRecords.length > 0) {
      const bulkOperations = usersWithLocationRecords.map(user => {
        const filteredLocations = (user.allowedLocations || []).filter(loc => loc !== location.name);
        const update = {
          allowedLocations: filteredLocations
        };

        impactedUsersResponse.push({
          id: user._id,
          username: user.username,
          name: user.name || user.username,
          hadOnlyLocation: user.allowedLocations.length === 1
        });

        return {
          updateOne: {
            filter: { _id: user._id },
            update: { $set: update }
          }
        };
      });

      if (bulkOperations.length > 0) {
        await dbOperation(() => User.bulkWrite(bulkOperations));
      }
    }

    if (pricingConfigsForLocation.length > 0) {
      await dbOperation(() => PricingConfig.deleteMany({ location: location.name }));
    }

    // Delete the location after cleaning up
    await dbOperation(() => Location.findByIdAndDelete(req.params.id));

    res.json({
      message: 'Location deleted successfully',
      impactedUsers: impactedUsersResponse
      , removedPricingConfigs: pricingConfigsForLocation.length
    });
  } catch (error) {
    console.error('Error deleting location:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});


module.exports = router;

