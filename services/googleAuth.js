const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/meetings.space.created',
  'https://www.googleapis.com/auth/meetings.space.readonly',
  'https://www.googleapis.com/auth/admin.reports.audit.readonly',
  'https://www.googleapis.com/auth/cloud-platform'
];

class GoogleAuthService {
  constructor() {
    this.authClient = null;
    this.initialized = false;
  }

  async initialize() {
    try {
      if (this.initialized) return this.authClient;

      const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
      const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
      const impersonateUser = process.env.GOOGLE_IMPERSONATE_USER;

      if (!serviceAccountEmail || !privateKey) {
        throw new Error('Google service account credentials not configured');
      }

      this.authClient = new google.auth.JWT({
        email: serviceAccountEmail,
        key: privateKey,
        scopes: SCOPES,
        subject: impersonateUser
      });

      await this.authClient.authorize();
      this.initialized = true;
      
      console.log('Google Auth initialized successfully');
      return this.authClient;
    } catch (error) {
      console.error('Failed to initialize Google Auth:', error);
      throw error;
    }
  }

  async getGoogleAuthClient() {
    if (!this.initialized) {
      await this.initialize();
    }
    return this.authClient;
  }

  async refreshToken() {
    try {
      if (this.authClient) {
        await this.authClient.refreshAccessToken();
        return this.authClient;
      }
      return await this.initialize();
    } catch (error) {
      console.error('Failed to refresh token:', error);
      throw error;
    }
  }

  async createCalendarEvent(eventData) {
    try {
      const auth = await this.getGoogleAuthClient();
      const calendar = google.calendar({ version: 'v3', auth });

      const event = {
        summary: eventData.title,
        description: eventData.description,
        start: {
          dateTime: new Date(eventData.startTime).toISOString(),
          timeZone: 'UTC'
        },
        end: {
          dateTime: new Date(eventData.endTime).toISOString(),
          timeZone: 'UTC'
        },
        attendees: eventData.attendees?.map(email => ({ email })) || [],
        conferenceData: {
          createRequest: {
            requestId: `meeting-${Date.now()}`,
            conferenceSolutionKey: {
              type: 'hangoutsMeet'
            }
          }
        },
        reminders: {
          useDefault: true
        }
      };

      const response = await calendar.events.insert({
        calendarId: 'primary',
        resource: event,
        conferenceDataVersion: 1,
        sendUpdates: 'all'
      });

      return {
        eventId: response.data.id,
        meetLink: response.data.hangoutLink,
        conferenceId: response.data.conferenceData?.conferenceId,
        htmlLink: response.data.htmlLink
      };
    } catch (error) {
      console.error('Error creating calendar event:', error);
      throw error;
    }
  }

  async getCalendarEvents(calendarId = 'primary', timeMin, timeMax) {
    try {
      const auth = await this.getGoogleAuthClient();
      const calendar = google.calendar({ version: 'v3', auth });

      const response = await calendar.events.list({
        calendarId,
        timeMin: timeMin || new Date().toISOString(),
        timeMax: timeMax || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 100
      });

      return response.data.items;
    } catch (error) {
      console.error('Error fetching calendar events:', error);
      throw error;
    }
  }
}

module.exports = new GoogleAuthService();