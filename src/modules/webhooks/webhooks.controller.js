import crypto from 'crypto';
import prisma from '../../database/index.js';
import { logger } from '../../middlewares/logging.middleware.js';

const log = logger.child({ module: 'webhooks' });

const verifySignature = (req) => {
  const secret = process.env.EMAIL_WEBHOOK_SECRET;
  if (!secret) return true; // If no secret configured, allow (mostly for dev)

  // Wait, different providers have different signature mechanisms.
  // We'll implement a standard HMAC SHA256 over the raw body for generic use.
  const signature = req.headers['x-webhook-signature'];
  if (!signature) return false;

  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(req.body);
  const expected = hmac.digest('hex');
  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  
  if (sigBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
};

export const handleEmailWebhook = async (req, res, next) => {
  try {
    if (process.env.EMAIL_WEBHOOK_SECRET && !verifySignature(req)) {
      log.warn({ ip: req.ip }, '[webhooks] Invalid webhook signature');
      return res.status(401).json({ status: 'error', message: 'Invalid signature' });
    }

    // req.body is a Buffer because express.raw() is used in app.js
    let payload;
    try {
      payload = JSON.parse(req.body.toString('utf8'));
    } catch (err) {
      return res.status(400).json({ status: 'error', message: 'Invalid JSON body' });
    }

    const event = payload.event;
    const email = payload.email;

    if (!event || !email) {
      return res.status(200).json({ status: 'success' }); // Ignore malformed but 200
    }

    // Update notification delivery state if message-id is provided (simplified: update any for user)
    // Actually, usually webhook provides a message ID, but let's assume it provides email.
    
    // We update User.emailBounced if hard bounce or spam
    if (event === 'bounce' || event === 'spam' || event === 'hard_bounce') {
      await prisma.user.updateMany({
        where: { email },
        data: { emailBounced: true }
      });
      log.info({ email, event }, '[webhooks] Marked user email as bounced');
    }

    // Also update notification if notificationId or similar was passed via tags
    // For now, we fulfill the requirement: write event into Notification.deliveryState + deliveredAt
    if (payload.tags && payload.tags.notificationId) {
      await prisma.notification.updateMany({
        where: { id: payload.tags.notificationId },
        data: {
          deliveryState: event,
          deliveredAt: event === 'delivered' ? new Date() : null
        }
      });
    }

    return res.status(200).json({ status: 'success' });
  } catch (err) {
    next(err);
  }
};
