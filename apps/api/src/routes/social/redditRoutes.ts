import { Router } from 'express';
import { RedditController } from '../../controllers/social/RedditController';
import { ApiKeyGuard } from '../../middleware/ApiKeyGuard';
import { RequestLogger } from '../../middleware/RequestLogger';

const router = Router();

router.use(RequestLogger);
router.use(ApiKeyGuard);

router.post('/inspect', RedditController.inspect);
router.get('/status', RedditController.status);

export default router;
