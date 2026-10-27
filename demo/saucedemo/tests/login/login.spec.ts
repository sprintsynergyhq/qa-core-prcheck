import { expect, test } from '@playwright/test';
import { USERS } from '../../fixtures/users';
import { InventoryPage } from '../../pages/inventory-page';
import { LoginPage } from '../../pages/login-page';

test.describe('login', { tag: '@login' }, () => {
  test('standard user lands on the products page', async ({ page }) => {
    const loginPage = new LoginPage(page);
    const inventoryPage = new InventoryPage(page);

    await loginPage.goto();
    await loginPage.login(USERS.standard);

    await expect(page).toHaveURL(/\/inventory\.html$/);
    await expect(inventoryPage.title).toHaveText('Products');
  });

  test('locked out user sees an error', async ({ page }) => {
    const loginPage = new LoginPage(page);

    await loginPage.goto();
    await loginPage.login(USERS.lockedOut);

    await expect(loginPage.error).toHaveText('Epic sadface: Sorry, this user has been locked out.');
  });
});
