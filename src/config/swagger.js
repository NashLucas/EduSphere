import swaggerJsdoc from 'swagger-jsdoc';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'EduSphere Backend API',
      description: 'RESTful API documentation for the EduSphere E-Learning & Assessment Platform.\n\nThe specification is assembled at runtime by `swagger-jsdoc` from route annotations (TRD §3.3).',
      version: '1.0.0',
    },
    servers: [
      {
        url: 'http://localhost:3000/api/v1',
        description: 'Local Development Server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: {
        HealthStatus: {
          type: 'object',
          description: 'Flat, deliberately not wrapped in the { status, message, data } envelope of apidoc §1. `status: "ok"` is the literal string asserted by AC-10 and read by the Dockerfile HEALTHCHECK; enveloping it breaks both.',
          required: ['status', 'database', 'redis', 'uptime'],
          properties: {
            status: {
              type: 'string',
              enum: ['ok', 'error'],
              example: 'ok',
            },
            database: {
              type: 'string',
              description: 'PostgreSQL reachability, proven by a query rather than by connection state.',
              enum: ['connected', 'disconnected'],
              example: 'connected',
            },
            redis: {
              type: 'string',
              description: 'Redis reachability, proven by a PING rather than by connection state.',
              enum: ['connected', 'disconnected'],
              example: 'connected',
            },
            uptime: {
              type: 'number',
              description: 'Process uptime in seconds.',
              example: 14250,
            },
          },
        },
      },
    },
    security: [
      {
        bearerAuth: [],
      },
    ],
  },
  // Paths to files containing OpenAPI definitions
  apis: ['./src/app.js', './src/routes/*.js', './src/modules/**/*.routes.js', './src/modules/**/*.js'],
};

const swaggerSpec = swaggerJsdoc(options);

export default swaggerSpec;
