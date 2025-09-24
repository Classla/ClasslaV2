export { 
  workos, 
  workosAuthService, 
  WORKOS_CONFIG, 
  WorkOSAuthService,
  WorkOSAuthenticationError,
  type WorkOSUser,
  type AuthenticationResult
} from './workos';

export {
  sessionManagementService,
  SessionManagementService,
  SessionManagementError,
  type UserSessionData,
  type SessionConfig
} from './session';

export {
  userSynchronizationService,
  UserSynchronizationService,
  UserSynchronizationError,
  type SupabaseUser
} from './userSync';