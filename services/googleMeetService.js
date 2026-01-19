const { google } = require('googleapis');
const { getGoogleAuthClient } = require('./googleAuth');
const Meeting = require('../models/Meeting');

class GoogleMeetService {
  constructor() {
    this.authClient = null;
    this.meetService = null;
  }

  async initialize() {
    this.authClient = await getGoogleAuthClient();
    this.meetService = google.meet({ version: 'v2', auth: this.authClient });
    return this;
  }

  async fetchGoogleMeetAttendance(meetSpaceId) {
    try {
      if (!this.meetService) await this.initialize();

      console.log(`Fetching attendance for space: ${meetSpaceId}`);
      
      const response = await this.meetService.spaces.participants.list({
        parent: `spaces/${meetSpaceId}`,
        pageSize: 100
      });

      const participants = response.data.participants || [];
      
      return participants.map(p => ({
        email: p.user?.email || p.anonymousUser?.displayName || null,
        name: p.user?.displayName || p.anonymousUser?.displayName || 'Unknown',
        joinTime: p.session?.startTime ? new Date(p.session.startTime) : null,
        leaveTime: p.session?.endTime ? new Date(p.session.endTime) : null,
        duration: p.session?.startTime && p.session?.endTime
          ? Math.round((new Date(p.session.endTime) - new Date(p.session.startTime)) / 60000)
          : null,
        isAnonymous: !p.user?.email,
        deviceType: p.device?.deviceType || 'unknown'
      }));
    } catch (error) {
      console.error('Error fetching Google Meet attendance:', error);
      throw error;
    }
  }

  async syncGoogleMeetAttendance(meetingId) {
    try {
      const meeting = await Meeting.findById(meetingId);
      if (!meeting) {
        throw new Error('Meeting not found');
      }

      if (!meeting.meetSpaceId) {
        // Extract meet space ID from link
        const match = meeting.meetLink.match(/meet\.google\.com\/([a-zA-Z0-9-]+)/);
        if (!match) {
          throw new Error('Invalid Google Meet link');
        }
        meeting.meetSpaceId = match[1];
      }

      // Fetch attendance from Google Meet API
      const googleAttendance = await this.fetchGoogleMeetAttendance(meeting.meetSpaceId);
      
      // Update meeting attendees
      const updatedAttendees = [];
      const externalAttendees = [];
      
      googleAttendance.forEach(record => {
        if (record.email) {
          const existingAttendee = meeting.attendees.find(
            a => a.email.toLowerCase() === record.email.toLowerCase()
          );

          if (existingAttendee) {
            // Update existing attendee
            existingAttendee.joinedAt = record.joinTime || existingAttendee.joinedAt;
            existingAttendee.leftAt = record.leaveTime || existingAttendee.leftAt;
            existingAttendee.duration = record.duration || existingAttendee.duration;
            existingAttendee.lastUpdated = new Date();
            updatedAttendees.push(existingAttendee);
          } else {
            // New external attendee
            const externalAttendee = {
              email: record.email,
              name: record.name,
              joinedAt: record.joinTime,
              leftAt: record.leaveTime,
              duration: record.duration,
              status: 'external',
              isExternal: true,
              joinType: 'external_link',
              lastUpdated: new Date()
            };
            externalAttendees.push(externalAttendee);
            updatedAttendees.push(externalAttendee);
          }
        }
      });

      // Update meeting with new attendees
      meeting.attendees = updatedAttendees;
      meeting.stats.totalExternal = externalAttendees.length;
      meeting.lastSyncTime = new Date();
      meeting.syncStatus = 'synced';

      // Calculate meeting duration
      if (meeting.actualStartTime && meeting.actualEndTime) {
        meeting.actualDuration = Math.round(
          (meeting.actualEndTime - meeting.actualStartTime) / 60000
        );
      }

      await meeting.save();

      return {
        success: true,
        syncedCount: updatedAttendees.length,
        externalCount: externalAttendees.length,
        meeting: meeting
      };
    } catch (error) {
      console.error('Error syncing Google Meet attendance:', error);
      throw error;
    }
  }

  async createGoogleMeetMeeting(meetingData) {
    try {
      if (!this.meetService) await this.initialize();

      const requestBody = {
        conferenceData: {
          createRequest: {
            requestId: `meeting-${Date.now()}`,
            conferenceSolutionKey: {
              type: 'hangoutsMeet'
            }
          }
        },
        start: {
          dateTime: new Date(meetingData.scheduledTime).toISOString(),
          timeZone: 'UTC'
        },
        end: {
          dateTime: new Date(new Date(meetingData.scheduledTime).getTime() + meetingData.duration * 60000).toISOString(),
          timeZone: 'UTC'
        },
        summary: meetingData.title,
        description: meetingData.description,
        attendees: meetingData.attendees || []
      };

      const response = await this.meetService.conferences.create({
        requestBody
      });

      return {
        meetLink: response.data.hangoutLink,
        meetSpaceId: response.data.conferenceId,
        conferenceData: response.data
      };
    } catch (error) {
      console.error('Error creating Google Meet:', error);
      throw error;
    }
  }

  async getMeetingAnalytics(meetSpaceId) {
    try {
      if (!this.meetService) await this.initialize();

      const response = await this.meetService.spaces.get({
        name: `spaces/${meetSpaceId}`
      });

      const space = response.data;
      
      // Get participants with duration
      const participants = await this.fetchGoogleMeetAttendance(meetSpaceId);
      
      const analytics = {
        totalParticipants: participants.length,
        participantsByDevice: participants.reduce((acc, p) => {
          acc[p.deviceType] = (acc[p.deviceType] || 0) + 1;
          return acc;
        }, {}),
        averageDuration: participants.length > 0
          ? Math.round(participants.reduce((sum, p) => sum + (p.duration || 0), 0) / participants.length)
          : 0,
        joinTimes: participants.map(p => p.joinTime),
        leaveTimes: participants.map(p => p.leaveTime),
        spaceInfo: {
          name: space.name,
          meetingCode: space.meetingCode,
          meetingUri: space.meetingUri,
          config: space.config
        }
      };

      return analytics;
    } catch (error) {
      console.error('Error getting meeting analytics:', error);
      throw error;
    }
  }
}

module.exports = new GoogleMeetService();