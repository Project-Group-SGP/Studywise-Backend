import { authenticateToken } from '../../middleware/auth';
import * as controller from './controller';
import { Router } from 'express';

const router = Router();

// @ts-ignore
router.post('/create',authenticateToken  ,controller.createSession);

//@ts-ignore
router.post('/get' ,authenticateToken ,controller.getAllSessions);

//@ts-ignore
router.post('/delete' ,authenticateToken ,controller.deleteSession);

//@ts-ignore
router.post('/update' ,authenticateToken ,controller.updateSession);

export default router;