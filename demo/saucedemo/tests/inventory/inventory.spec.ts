import { expect, test } from '@playwright/test';
import { USERS } from '../../fixtures/users';
import { InventoryPage } from '../../pages/inventory-page';
import { LoginPage } from '../../pages/login-page';

test.describe('inventory', { tag: '@inventory' }, () => {
  test.beforeEach(async ({ page }) => {
    await new LoginPage(page).loginAs(USERS.standard);
  });

  test('sorts products by price low to high', async ({ page }) => {
    const inventoryPage = new InventoryPage(page);

    await inventoryPage.sortBy('lohi');
    const prices = await inventoryPage.priceValues();

    expect(prices.length).toBeGreaterThan(1);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });

  test('sorts products by name Z to A', async ({ page }) => {
    const inventoryPage = new InventoryPage(page);

    await inventoryPage.sortBy('za');
    const names = await inventoryPage.nameValues();

    expect(names.length).toBeGreaterThan(1);
    expect(names).toEqual([...names].sort((a, b) => b.localeCompare(a)));
  });
});
