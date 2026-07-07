import {
  CognitoIdentityProviderClient,
  SignUpCommand,
  AdminConfirmSignUpCommand,
  AdminDeleteUserCommand,
  InitiateAuthCommand,
  AuthFlowType,
} from '@aws-sdk/client-cognito-identity-provider';
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';

// Hits the *deployed* AuthStack in a real AWS account — opt in explicitly so
// `pnpm test` stays offline by default:
//   RUN_AWS_INTEGRATION_TESTS=1 pnpm exec jest auth-flow.integration --no-coverage
const RUN = process.env.RUN_AWS_INTEGRATION_TESTS === '1';
const REGION = process.env.AWS_REGION || process.env.CDK_DEFAULT_REGION || 'eu-north-1';
const TEST_PASSWORD = 'TestPass123';

function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split('.')[1];
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

function uniqueTestEmail(): string {
  return `stockping-qa+${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

(RUN ? describe : describe.skip)('Deployed AuthStack — live Cognito auth flow', () => {
  const cognito = new CognitoIdentityProviderClient({ region: REGION });
  const cfn = new CloudFormationClient({ region: REGION });
  const createdUsernames: string[] = [];
  let userPoolId: string;
  let clientId: string;

  beforeAll(async () => {
    const { Stacks } = await cfn.send(new DescribeStacksCommand({ StackName: 'AuthStack' }));
    const outputs = Stacks?.[0]?.Outputs ?? [];
    userPoolId = outputs.find((o) => o.OutputKey === 'UserPoolId')?.OutputValue ?? '';
    clientId = outputs.find((o) => o.OutputKey === 'UserPoolClientId')?.OutputValue ?? '';

    if (!userPoolId || !clientId) {
      throw new Error('AuthStack outputs UserPoolId/UserPoolClientId not found — is the stack deployed?');
    }
  }, 30_000);

  afterAll(async () => {
    await Promise.all(
      createdUsernames.map((username) =>
        cognito
          .send(new AdminDeleteUserCommand({ UserPoolId: userPoolId, Username: username }))
          .catch(() => undefined),
      ),
    );
  }, 30_000);

  async function signUp(email: string, password: string) {
    await cognito.send(
      new SignUpCommand({
        ClientId: clientId,
        Username: email,
        Password: password,
        UserAttributes: [{ Name: 'email', Value: email }],
      }),
    );
    createdUsernames.push(email);
  }

  async function signUpAndConfirm(email: string, password: string) {
    await signUp(email, password);
    await cognito.send(new AdminConfirmSignUpCommand({ UserPoolId: userPoolId, Username: email }));
  }

  test(
    'sign-up -> admin-confirm-sign-up -> USER_PASSWORD_AUTH returns tokens with correct JWT claims',
    async () => {
      const email = uniqueTestEmail();
      await signUpAndConfirm(email, TEST_PASSWORD);

      // No SECRET_HASH is passed — this only succeeds because the App Client has no secret.
      const authResult = await cognito.send(
        new InitiateAuthCommand({
          ClientId: clientId,
          AuthFlow: AuthFlowType.USER_PASSWORD_AUTH,
          AuthParameters: { USERNAME: email, PASSWORD: TEST_PASSWORD },
        }),
      );

      expect(authResult.AuthenticationResult?.IdToken).toBeDefined();
      expect(authResult.AuthenticationResult?.AccessToken).toBeDefined();
      expect(authResult.AuthenticationResult?.RefreshToken).toBeDefined();

      const claims = decodeJwtPayload(authResult.AuthenticationResult!.IdToken!);
      expect(claims.email).toBe(email);
      expect(claims.token_use).toBe('id');
      expect(claims.aud).toBe(clientId);
      expect(typeof claims.sub).toBe('string');
      expect(claims.sub).toMatch(/^[0-9a-f-]{36}$/);
      // cognito:username is the pool-generated UUID (== sub), not the email —
      // UsernameAttributes: [email] makes email a sign-in alias, not the username itself.
      expect(claims['cognito:username']).toBe(claims.sub);
    },
    30_000,
  );

  test(
    'rejects USER_PASSWORD_AUTH with the wrong password',
    async () => {
      const email = uniqueTestEmail();
      await signUpAndConfirm(email, TEST_PASSWORD);

      await expect(
        cognito.send(
          new InitiateAuthCommand({
            ClientId: clientId,
            AuthFlow: AuthFlowType.USER_PASSWORD_AUTH,
            AuthParameters: { USERNAME: email, PASSWORD: 'WrongPassword999' },
          }),
        ),
      ).rejects.toMatchObject({ name: 'NotAuthorizedException' });
    },
    30_000,
  );

  test(
    'rejects USER_PASSWORD_AUTH for a user who has not confirmed sign-up',
    async () => {
      const email = uniqueTestEmail();
      await signUp(email, TEST_PASSWORD); // deliberately skip admin-confirm-sign-up

      await expect(
        cognito.send(
          new InitiateAuthCommand({
            ClientId: clientId,
            AuthFlow: AuthFlowType.USER_PASSWORD_AUTH,
            AuthParameters: { USERNAME: email, PASSWORD: TEST_PASSWORD },
          }),
        ),
      ).rejects.toMatchObject({ name: 'UserNotConfirmedException' });
    },
    30_000,
  );

  test(
    'rejects a duplicate sign-up for an email already registered',
    async () => {
      const email = uniqueTestEmail();
      await signUp(email, TEST_PASSWORD);

      await expect(signUp(email, TEST_PASSWORD)).rejects.toMatchObject({
        name: 'UsernameExistsException',
      });
    },
    30_000,
  );
});
