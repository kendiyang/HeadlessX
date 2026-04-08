import { Router } from 'express';
import { EbayController } from '../../controllers/commerce/EbayController';
import { ApiKeyGuard } from '../../middleware/ApiKeyGuard';
import { RequestLogger } from '../../middleware/RequestLogger';

const router = Router();

router.use(RequestLogger);
router.use(ApiKeyGuard);

router.post('/inspect', EbayController.inspect);
router.get('/status', EbayController.status);

export default router;
