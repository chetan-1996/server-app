const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const LoginLog = require('../models/LoginLog');
const CalculatorLog = require('../models/CalculatorLog');

// Get all login logs with pagination
router.get('/login-logs', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 100; // Default to 100, max 1000
    const maxLimit = 1000;
    const actualLimit = Math.min(limit, maxLimit);
    const skip = (page - 1) * actualLimit;
    
    // Get total count for pagination info
    const totalCount = await LoginLog.countDocuments();
    
    const logs = await LoginLog.find()
      .populate('userId', 'username name role')
      .sort({ loginDate: -1 })
      .skip(skip)
      .limit(actualLimit);
    
    // Ensure each log has complete user information
    const processedLogs = logs.map(log => {
      // If log doesn't have role property but has userId with role
      if (!log.role && log.userId && log.userId.role) {
        log.role = log.userId.role;
      }
      return log;
    });
    
    res.json({
      logs: processedLogs,
      pagination: {
        page,
        limit: actualLimit,
        total: totalCount,
        totalPages: Math.ceil(totalCount / actualLimit)
      }
    });
  } catch (error) {
    console.error('Error fetching login logs:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get login logs by role with pagination
router.get('/login-logs/by-role/:role', async (req, res) => {
  try {
    const { role } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 100;
    const maxLimit = 1000;
    const actualLimit = Math.min(limit, maxLimit);
    const skip = (page - 1) * actualLimit;
    
    if (!['Admin', 'User'].includes(role)) {
      return res.status(400).json({ message: 'Invalid role specified' });
    }
    
    // Get total count for pagination info
    const totalCount = await LoginLog.countDocuments({ role });
    
    const logs = await LoginLog.find({ role })
      .populate('userId', 'username name role')
      .sort({ loginDate: -1 })
      .skip(skip)
      .limit(actualLimit);
    
    // Ensure each log has complete user information
    const processedLogs = logs.map(log => {
      // If log doesn't have role property but has userId with role
      if (!log.role && log.userId && log.userId.role) {
        log.role = log.userId.role;
      }
      return log;
    });
    
    res.json({
      logs: processedLogs,
      pagination: {
        page,
        limit: actualLimit,
        total: totalCount,
        totalPages: Math.ceil(totalCount / actualLimit)
      }
    });
  } catch (error) {
    console.error('Error fetching login logs by role:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get all calculator logs with pagination
router.get('/calculator-logs', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 100; // Default to 100, max 1000
    const maxLimit = 1000;
    const actualLimit = Math.min(limit, maxLimit);
    const skip = (page - 1) * actualLimit;
    
    // Get total count for pagination info
    const totalCount = await CalculatorLog.countDocuments();
    
    const logs = await CalculatorLog.find()
      .populate('userId', 'username name role')
      .sort({ calculationDate: -1 })
      .skip(skip)
      .limit(actualLimit);
    
    // Ensure each log has complete user information
    const processedLogs = logs.map(log => {
      // If log doesn't have role property but has userId with role
      if (!log.role && log.userId && log.userId.role) {
        log.role = log.userId.role;
      }
      return log;
    });
    
    res.json({
      logs: processedLogs,
      pagination: {
        page,
        limit: actualLimit,
        total: totalCount,
        totalPages: Math.ceil(totalCount / actualLimit)
      }
    });
  } catch (error) {
    console.error('Error fetching calculator logs:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get calculator analytics (daily calculation counts)
router.get('/calculator-analytics', async (req, res) => {
  try {
    
    // Aggregate calculations by date
    const analyticsData = await CalculatorLog.aggregate([
      {
        $group: {
          _id: {
            $dateToString: {
              format: "%Y-%m-%d",
              date: "$calculationDate"
            }
          },
          calculationCount: { $sum: 1 }
        }
      },
      {
        $project: {
          date: "$_id",
          calculationCount: 1,
          _id: 0
        }
      },
      {
        $sort: { date: -1 }
      }

    ]);


    res.json({
      success: true,
      analytics: analyticsData,
      totalDays: analyticsData.length,
      totalCalculations: analyticsData.reduce((sum, item) => sum + item.calculationCount, 0)
    });
  } catch (error) {
    console.error('Error fetching calculator analytics:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get calculator logs by role with pagination
router.get('/calculator-logs/by-role/:role', async (req, res) => {
  try {
    const { role } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 100;
    const maxLimit = 1000;
    const actualLimit = Math.min(limit, maxLimit);
    const skip = (page - 1) * actualLimit;
    
    if (!['Admin', 'User'].includes(role)) {
      return res.status(400).json({ message: 'Invalid role specified' });
    }
    
    // Get total count for pagination info
    const totalCount = await CalculatorLog.countDocuments({ role });
    
    const logs = await CalculatorLog.find({ role })
      .populate('userId', 'username name role')
      .sort({ calculationDate: -1 })
      .skip(skip)
      .limit(actualLimit);
    
    // Ensure each log has complete user information
    const processedLogs = logs.map(log => {
      // If log doesn't have role property but has userId with role
      if (!log.role && log.userId && log.userId.role) {
        log.role = log.userId.role;
      }
      return log;
    });
    
    res.json({
      logs: processedLogs,
      pagination: {
        page,
        limit: actualLimit,
        total: totalCount,
        totalPages: Math.ceil(totalCount / actualLimit)
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Delete a specific login log
router.delete('/login-logs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const deletedLog = await LoginLog.findByIdAndDelete(id);
    
    if (!deletedLog) {
      return res.status(404).json({ message: 'Login log not found' });
    }
    
    res.json({ message: 'Login log deleted successfully', deletedId: id });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Delete a specific calculator log
router.delete('/calculator-logs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const deletedLog = await CalculatorLog.findByIdAndDelete(id);
    
    if (!deletedLog) {
      return res.status(404).json({ message: 'Calculator log not found' });
    }
    
    res.json({ message: 'Calculator log deleted successfully', deletedId: id });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Export login logs to Excel
router.get('/export/login-logs', async (req, res) => {
  try {
    const logs = await LoginLog.find()
      .populate('userId', 'username name')
      .sort({ loginDate: -1 });

    // Create a new workbook and worksheet
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Login Logs');

    // Add headers
    worksheet.columns = [
      { header: 'User ID', key: 'username', width: 15 },
      { header: 'Name', key: 'name', width: 20 },
      { header: 'Role', key: 'role', width: 15 },
      { header: 'Login Date', key: 'loginDate', width: 12 },
      { header: 'Login Time', key: 'loginTime', width: 12 }
    ];

    // Style the header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    // Add data rows
    logs.forEach(log => {
      const loginDate = new Date(log.loginDate);
      worksheet.addRow({
        username: log.username,
        name: log.name,
        role: log.role,
        loginDate: loginDate.toLocaleDateString(),
        loginTime: loginDate.toLocaleTimeString()
      });
    });

    // Set response headers for Excel download
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=login-logs-${new Date().toISOString().split('T')[0]}.xlsx`);

    // Write to response
    await workbook.xlsx.write(res);
    res.end();

  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Export calculator logs to Excel
router.get('/export/calculator-logs', async (req, res) => {
  try {
    const logs = await CalculatorLog.find()
      .populate('userId', 'username name')
      .sort({ calculationDate: -1 });

    // Create a new workbook and worksheet
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Calculator Logs');

    // Add headers
    worksheet.columns = [
      { header: 'User ID', key: 'username', width: 15 },
      { header: 'Name', key: 'name', width: 20 },
      { header: 'Role', key: 'role', width: 15 },
      { header: 'Date', key: 'date', width: 12 },
      { header: 'Time', key: 'time', width: 12 },
      { header: 'Customer Name', key: 'customerName', width: 20 },
      { header: 'Mobile', key: 'mobile', width: 15 },
      { header: 'Panel', key: 'panel', width: 15 },
      { header: 'System kW', key: 'systemKW', width: 10 },
      { header: 'Final Price', key: 'finalPrice', width: 15 }
    ];

    // Style the header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    // Add data rows
    logs.forEach(log => {
      const calculationDate = new Date(log.calculationDate);
      worksheet.addRow({
        username: log.username,
        name: log.name,
        role: log.role,
        date: calculationDate.toLocaleDateString(),
        time: calculationDate.toLocaleTimeString(),
        customerName: log.inputData?.customerName || 'N/A',
        mobile: log.inputData?.customerMobile || 'N/A',
        panel: log.inputData?.panelName || log.inputData?.selectedPanel || 'N/A',
        systemKW: log.inputData?.systemKW || 'N/A',
        finalPrice: log.results?.finalPrice ? `₹${log.results.finalPrice.toLocaleString()}` : 'N/A'
      });
    });

    // Set response headers for Excel download
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=calculator-logs-${new Date().toISOString().split('T')[0]}.xlsx`);

    // Write to response
    await workbook.xlsx.write(res);
    res.end();

  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get user calculation analytics
router.get('/analytics/user-calculations', async (req, res) => {
  try {
    // Aggregate calculations by user
    const userCalculations = await CalculatorLog.aggregate([
      {
        $group: {
          _id: '$userId',
          username: { $first: '$username' },
          name: { $first: '$name' },
          role: { $first: '$role' },
          calculationCount: { $sum: 1 },
          lastCalculation: { $max: '$calculationDate' }
        }
      },
      {
        $sort: { calculationCount: -1 }
      },
      {
        $limit: 20 // Top 20 users
      }
    ]);

    res.json(userCalculations);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Dashboard Statistics Endpoints

// Get dashboard login statistics
router.get('/dashboard/login-stats', async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    
    // Today's total logins
    const todayLogins = await LoginLog.countDocuments({
      loginDate: { $gte: today, $lt: tomorrow }
    });
    
    // Last 5 users who logged in
    const recentLogins = await LoginLog.find()
      .populate('userId', 'username name')
      .sort({ loginDate: -1 })
      .limit(5)
      .select('username name loginDate userId');
    
    res.json({
      todayLogins,
      recentLogins
    });
  } catch (error) {
    console.error('Error fetching login dashboard stats:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get dashboard calculator statistics
router.get('/dashboard/calculator-stats', async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    // Today's total calculations
    const todayCalculations = await CalculatorLog.countDocuments({
      calculationDate: { $gte: today, $lt: tomorrow }
    });
    
    // Top 3 users by calculation count today
    const topUsersToday = await CalculatorLog.aggregate([
      {
        $match: {
          calculationDate: { $gte: today, $lt: tomorrow }
        }
      },
      {
        $group: {
          _id: '$userId',
          username: { $first: '$username' },
          name: { $first: '$name' },
          calculationCount: { $sum: 1 }
        }
      },
      {
        $sort: { calculationCount: -1 }
      },
      {
        $limit: 3
      }
    ]);
    
    res.json({
      todayCalculations,
      topUsersToday
    });
  } catch (error) {
    console.error('Error fetching calculator dashboard stats:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get daily dashboard statistics (simplified: only top user of the month)
router.get('/dashboard/daily-stats', async (req, res) => {
  try {
    const now = new Date();
    const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    // Top user of this month (ALL users system-wide, not filtered by localhost)
    const topUserThisMonth = await CalculatorLog.aggregate([
      {
        $match: {
          calculationDate: { $gte: currentMonth, $lt: nextMonth }
        }
      },
      {
        $group: {
          _id: '$userId',
          username: { $first: '$username' },
          name: { $first: '$name' },
          role: { $first: '$role' },
          calculationCount: { $sum: 1 }
        }
      },
      {
        $sort: { calculationCount: -1 }
      },
      {
        $limit: 1
      }
    ]);

    const topUser = topUserThisMonth.length > 0 ? topUserThisMonth[0] : null;

    res.json({
      topUser: topUser ? {
        username: topUser.username,
        name: topUser.name,
        role: topUser.role,
        calculationCount: topUser.calculationCount
      } : null
    });
  } catch (error) {
    console.error('Error fetching daily dashboard stats:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get monthly analytics statistics
router.get('/dashboard/monthly-analytics', async (req, res) => {
  try {
    const now = new Date();
    const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    
    // Get month range for display
    const monthNames = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"
    ];
    const monthName = monthNames[now.getMonth()];
    const year = now.getFullYear();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    
    // Top user of the month
    const topUserThisMonth = await CalculatorLog.aggregate([
      {
        $match: {
          calculationDate: { $gte: currentMonth, $lt: nextMonth }
        }
      },
      {
        $group: {
          _id: '$userId',
          username: { $first: '$username' },
          name: { $first: '$name' },
          calculationCount: { $sum: 1 }
        }
      },
      {
        $sort: { calculationCount: -1 }
      },
      {
        $limit: 1
      }
    ]);
    
    // Lowest user of the month (who has at least 1 calculation)
    const lowestUserThisMonth = await CalculatorLog.aggregate([
      {
        $match: {
          calculationDate: { $gte: currentMonth, $lt: nextMonth }
        }
      },
      {
        $group: {
          _id: '$userId',
          username: { $first: '$username' },
          name: { $first: '$name' },
          calculationCount: { $sum: 1 }
        }
      },
      {
        $sort: { calculationCount: 1 }
      },
      {
        $limit: 1
      }
    ]);
    
    res.json({
      topUser: topUserThisMonth[0] || null,
      lowestUser: lowestUserThisMonth[0] || null,
      periodCovered: `${monthName} 1st – ${lastDay}th, ${year}`
    });
  } catch (error) {
    console.error('Error fetching monthly analytics stats:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get calculation analytics for charts
router.get('/analytics/calculations', async (req, res) => {
  try {
    const { period = 'Monthly' } = req.query;
    const now = new Date();
    let startDate, endDate, groupFormat, labelFormat;

    // Calculate date ranges based on period
    switch (period) {
      case 'Monthly':
        // Last 30 days
        startDate = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
        endDate = now;
        groupFormat = {
          year: { $year: '$calculationDate' },
          month: { $month: '$calculationDate' },
          day: { $dayOfMonth: '$calculationDate' }
        };
        break;
      case 'Quarterly':
        // Last 3 months
        startDate = new Date(now.getFullYear(), now.getMonth() - 3, 1);
        endDate = now;
        groupFormat = {
          year: { $year: '$calculationDate' },
          month: { $month: '$calculationDate' }
        };
        break;
      case 'Annually':
        // Last 12 months
        startDate = new Date(now.getFullYear() - 1, now.getMonth(), 1);
        endDate = now;
        groupFormat = {
          year: { $year: '$calculationDate' },
          month: { $month: '$calculationDate' }
        };
        break;
      default:
        startDate = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
        endDate = now;
        groupFormat = {
          year: { $year: '$calculationDate' },
          month: { $month: '$calculationDate' },
          day: { $dayOfMonth: '$calculationDate' }
        };
    }

    // Aggregate calculations by date
    const analytics = await CalculatorLog.aggregate([
      {
        $match: {
          calculationDate: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: groupFormat,
          count: { $sum: 1 }
        }
      },
      {
        $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 }
      }
    ]);

    // Format data for chart
    const chartData = [];
    
    if (period === 'Monthly') {
      // Generate all 30 days and fill with data
      for (let i = 29; i >= 0; i--) {
        const date = new Date(now.getTime() - (i * 24 * 60 * 60 * 1000));
        const year = date.getFullYear();
        const month = date.getMonth() + 1;
        const day = date.getDate();
        
        const found = analytics.find(item => 
          item._id.year === year && 
          item._id.month === month && 
          item._id.day === day
        );
        
        chartData.push({
          date: date.toISOString().split('T')[0],
          count: found ? found.count : 0,
          label: `${month}/${day}`
        });
      }
    } else {
      // For quarterly and annually, use the aggregated data directly
      chartData.push(...analytics.map(item => {
        let date, label;
        
        if (period === 'Quarterly' || period === 'Annually') {
          date = new Date(item._id.year, item._id.month - 1, 1);
          const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                             'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
          label = `${monthNames[item._id.month - 1]} ${item._id.year}`;
        } else {
          date = new Date(item._id.year, item._id.month - 1, item._id.day);
          label = `${item._id.month}/${item._id.day}`;
        }
        
        return {
          date: date.toISOString().split('T')[0],
          count: item.count,
          label
        };
      }));
    }

    // Calculate total calculations in period
    const totalCalculations = chartData.reduce((sum, item) => sum + item.count, 0);
    
    // Get period description
    let periodDescription;
    switch (period) {
      case 'Monthly':
        periodDescription = 'last 30 days';
        break;
      case 'Quarterly':
        periodDescription = 'last 3 months';
        break;
      case 'Annually':
        periodDescription = 'last 12 months';
        break;
      default:
        periodDescription = 'last 30 days';
    }

    res.json({
      period,
      periodDescription,
      totalCalculations,
      data: chartData,
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0]
    });

  } catch (error) {
    console.error('Error fetching calculation analytics:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get top 5 users who logged in today
router.get('/dashboard/today-logins', async (req, res) => {
  try {
    // Use same Analytics approach for consistent results
    const now = new Date();
    const last24Hours = new Date(now.getTime() - (24 * 60 * 60 * 1000));

    // Get today's login activity using Analytics approach
    const todayLogins = await LoginLog.aggregate([
      {
        $match: {
          loginDate: { $gte: last24Hours, $lte: now }
        }
      },
      {
        $group: {
          _id: '$username',
          loginCount: { $sum: 1 },
          lastLogin: { $max: '$loginDate' }
        }
      },
      { $sort: { lastLogin: -1 } },
      { $limit: 5 }
    ])
    res.json(todayLogins);
  } catch (error) {

  }
});

// Get top 5 users who calculated today
router.get('/dashboard/today-calculations', async (req, res) => {
  try {
    // Use same Analytics approach for consistent results
    const now = new Date();
    const last24Hours = new Date(now.getTime() - (24 * 60 * 60 * 1000));

    // Get today's calculation activity using Analytics approach
    const todayCalculations = await CalculatorLog.aggregate([
      {
        $match: {
          calculationDate: { $gte: last24Hours, $lte: now }
        }
      },
      {
        $group: {
          _id: '$username',
          calculationCount: { $sum: 1 },
          lastCalculation: { $max: '$calculationDate' }
        }
      },
      { $sort: { lastCalculation: -1 } },
      { $limit: 5 }
    ]);

    res.json(todayCalculations);
  } catch (error) {
    console.error('Error fetching today calculations:', error);
    res.status(500).json({ error: 'Failed to fetch today calculations' });
  }
});

// Get top dates with maximum calculations
router.get('/dashboard/top-calculation-dates', async (req, res) => {
  try {
    const topDates = await CalculatorLog.aggregate([
      {
        $group: {
          _id: {
            year: { $year: '$calculationDate' },
            month: { $month: '$calculationDate' },
            day: { $dayOfMonth: '$calculationDate' }
          },
          calculationCount: { $sum: 1 }
        }
      },
      {
        $sort: { calculationCount: -1 }
      },
      { $limit: 5 },
      {
        $project: {
          date: {
            $dateFromParts: {
              year: '$_id.year',
              month: '$_id.month',
              day: '$_id.day'
            }
          },
          calculationCount: 1,
          _id: 0
        }
      }
    ]);

    res.json(topDates);
  } catch (error) {
    console.error('Error fetching top calculation dates:', error);
    res.status(500).json({ error: 'Failed to fetch top calculation dates' });
  }
});

module.exports = router; 