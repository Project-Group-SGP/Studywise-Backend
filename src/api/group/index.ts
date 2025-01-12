import { authenticateToken } from '../../middleware/auth';
import * as controller from './controller';
import { Router } from 'express';

const router = Router();

//@ts-ignore
router.post('/create',authenticateToken  ,controller.createGroup);

export default router;