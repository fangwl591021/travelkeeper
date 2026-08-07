const WORKSPACE_DEFINITIONS = Object.freeze({
  admin_dashboard: {
    title: '旅遊管家管理工作台',
    altText: '旅遊管家管理工作台',
    fallbackText: '旅遊管家管理工作台：訂單管理、待審行程、LINE OA監看',
    buttons: [
      ['訂單管理', 'orders'],
      ['待審行程', 'pendingItineraries'],
      ['LINE OA監看', 'lineMonitor']
    ]
  },
  partner_workspace: {
    title: '旅遊管家業務工作台',
    altText: '旅遊管家業務工作台',
    fallbackText: '旅遊管家業務工作台：我的訂單、我的客戶、推廣行程',
    buttons: [
      ['我的訂單', 'orders'],
      ['我的客戶', 'customers'],
      ['推廣行程', 'promotions']
    ]
  },
  traveler_workspace: {
    title: '旅遊管家旅客中心',
    altText: '旅遊管家旅客中心',
    fallbackText: '旅遊管家旅客中心：我的預約、查看行程、聯絡客服',
    buttons: [
      ['我的預約', 'reservations'],
      ['查看行程', 'itineraries'],
      ['聯絡客服', 'support']
    ]
  }
});

function requireSecureRoute(routes, key) {
  const value = routes && typeof routes === 'object' ? routes[key] : '';
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing required HTTPS route: ${key}`);
  }

  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`Invalid HTTPS route: ${key}`);
  }

  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) {
    throw new Error(`Route must use HTTPS: ${key}`);
  }
  return url.toString();
}

function buildWorkspaceFlex(input = {}) {
  const { targetIntent, routes } = input && typeof input === 'object' ? input : {};
  const definition = WORKSPACE_DEFINITIONS[targetIntent];
  if (!definition) {
    throw new Error(`Unsupported workspace intent: ${String(targetIntent)}`);
  }

  const actions = definition.buttons.map(([label, routeKey]) => ({
    type: 'button',
    style: 'link',
    height: 'sm',
    action: {
      type: 'uri',
      label,
      uri: requireSecureRoute(routes, routeKey)
    }
  }));

  return {
    message: {
      type: 'flex',
      altText: definition.altText,
      contents: {
        type: 'bubble',
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'text',
              text: definition.title,
              weight: 'bold',
              size: 'xl',
              wrap: true
            }
          ]
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: actions
        }
      }
    },
    fallbackText: definition.fallbackText
  };
}

export { buildWorkspaceFlex };
export default buildWorkspaceFlex;
