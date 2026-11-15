import { NotFoundException } from '@nestjs/common';
import { TestUiController } from './test-ui.controller';

function createConfig(values: Record<string, string> = {}) {
  return {
    get: jest.fn((key: string) => values[key]),
  };
}

function createResponseMock() {
  return {
    header: jest.fn(),
    send: jest.fn(),
  };
}

describe('TestUiController', () => {
  it('is disabled by default', () => {
    const controller = new TestUiController(createConfig({ NODE_ENV: 'development' }) as any);
    const response = createResponseMock();

    expect(() => controller.getTestUi(response as any)).toThrow(NotFoundException);
    expect(response.send).not.toHaveBeenCalled();
  });

  it('is disabled in production even if the flag is enabled', () => {
    const controller = new TestUiController(createConfig({
      NODE_ENV: 'production',
      ENABLE_TEST_UI: 'true',
    }) as any);
    const response = createResponseMock();

    expect(() => controller.getTestUi(response as any)).toThrow(NotFoundException);
    expect(response.send).not.toHaveBeenCalled();
  });

  it('renders only when explicitly enabled outside production and does not ship dev credentials', () => {
    const controller = new TestUiController(createConfig({
      NODE_ENV: 'development',
      ENABLE_TEST_UI: 'true',
    }) as any);
    const response = createResponseMock();

    controller.getTestUi(response as any);

    expect(response.header).toHaveBeenCalledWith('Content-Type', 'text/html');
    expect(response.send).toHaveBeenCalledTimes(1);
    const html = response.send.mock.calls[0][0];
    expect(html).toContain('Test UI');
    expect(html).not.toContain('password123');
    expect(html).not.toContain('ensureDevToken');
    expect(html).not.toContain('value="admin"');
  });
});
