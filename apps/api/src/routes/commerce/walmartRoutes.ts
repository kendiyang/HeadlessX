import { Router } from 'express';
import { WalmartController } from '../../controllers/commerce/WalmartController';
import { ApiKeyGuard } from '../../middleware/ApiKeyGuard';
import { RequestLogger } from '../../middleware/RequestLogger';

const router = Router();

router.use(RequestLogger);
router.use(ApiKeyGuard);

router.post('/inspect', WalmartController.inspect);
router.get('/status', WalmartController.status);

export default router;
