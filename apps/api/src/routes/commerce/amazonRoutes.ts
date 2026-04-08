import { Router } from 'express';
import { AmazonController } from '../../controllers/commerce/AmazonController';
import { ApiKeyGuard } from '../../middleware/ApiKeyGuard';
import { RequestLogger } from '../../middleware/RequestLogger';

const router = Router();

router.use(RequestLogger);
router.use(ApiKeyGuard);

router.post('/inspect', AmazonController.inspect);
router.get('/status', AmazonController.status);

export default router;
