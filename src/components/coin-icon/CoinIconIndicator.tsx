import React from 'react';
import Animated from 'react-native-reanimated';
import styled from 'styled-components';
import { Icon } from '../icons';
import { Centered } from '../layout';
import { useCoinListEditedValue } from '@rainbow-me/hooks/useCoinListEdited';
import { borders, shadow } from '@rainbow-me/styles';

const IndicatorIcon = styled(Icon).attrs(({ isPinned, theme: { colors } }) => ({
  color: colors.whiteLabel,
  name: isPinned ? 'pin' : 'hidden',
}))`
  height: ${({ isPinned }) => (isPinned ? 13 : 10)};
  margin-top: ${({ isPinned }) => (isPinned ? 1 : 0)};
  width: ${({ isPinned }) => (isPinned ? 8 : 14)};
`;

const IndicatorIconContainer = styled(Centered)`
  ${borders.buildCircle(22)};
  ${({ theme: { isDarkMode, colors } }) =>
    shadow.build(
      0,
      4,
      12,
      isDarkMode ? colors.shadow : colors.blueGreyDark,
      0.4
    )}
  align-self: center;
  background-color: ${({ theme: { colors } }) => colors.blueGreyDark50};
  bottom: 9;
  left: 19;
  position: absolute;
`;

export default function CoinIconIndicator({ isFirstCoinRow, isPinned }) {
  const isCoinListEditedValue = useCoinListEditedValue();

  return (
    <IndicatorIconContainer
      as={Animated.View}
      isFirstCoinRow={isFirstCoinRow}
      style={{ opacity: isCoinListEditedValue }}
    >
      <IndicatorIcon isPinned={isPinned} />
    </IndicatorIconContainer>
  );
}