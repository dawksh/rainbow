import React, { useEffect } from 'react';
import { Platform, View, ViewProps, ViewStyle } from 'react-native';
import {
  LongPressGestureHandler,
  LongPressGestureHandlerGestureEvent,
  LongPressGestureHandlerProps,
} from 'react-native-gesture-handler';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import Animated, {
  cancelAnimation,
  runOnJS,
  runOnUI,
  useAnimatedGestureHandler,
  useAnimatedProps,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  useWorkletCallback,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import * as redash from 'react-native-redash';
import Svg, { Path, PathProps } from 'react-native-svg';
import { PathData } from '../../helpers/ChartContext';
import { useChartData } from '../../helpers/useChartData';
import {
  requireOnWorklet,
  useWorkletValue,
} from '../../helpers/requireOnWorklet';

function ascending(a?: number, b?: number) {
  'worklet';

  return a == null || b == null
    ? NaN
    : a < b
    ? -1
    : a > b
    ? 1
    : a >= b
    ? 0
    : NaN;
}

function least(length: number, compare: typeof ascending = ascending) {
  'worklet';

  let min;
  let defined = false;

  let minValue;
  for (let i = 0; i < length; i++) {
    const value = compare(i);
    if (
      defined ? ascending(value, minValue) < 0 : ascending(value, value) === 0
    ) {
      min = i;
      minValue = value;
      defined = true;
    }
  }

  return min;
}

function impactHeavy() {
  'worklet';
  (runOnJS
    ? runOnJS(ReactNativeHapticFeedback.trigger)
    : ReactNativeHapticFeedback.trigger)('impactHeavy');
}

const timingFeedbackDefaultConfig = {
  duration: 80,
};

const timingAnimationDefaultConfig = {
  duration: 300,
};

const AnimatedPath = Animated.createAnimatedComponent(Path);

interface ChartPathProps extends PathProps {
  hapticsEnabled?: boolean;
  hitSlop?: number;
  fill?: string;
  height: number;
  width: number;
  selectedStrokeWidth?: number;
  selectedOpacity?: number;
  strokeWidth?: number;
  stroke?: string;
  gestureEnabled?: boolean;
  springConfig?: Animated.WithSpringConfig;
  longPressGestureHandlerProps?: LongPressGestureHandlerProps;
  timingFeedbackConfig?: Animated.WithTimingConfig;
  timingAnimationConfig?: Animated.WithTimingConfig;
}

function positionXWithMargin(x: number, margin: number, width: number) {
  'worklet';
  if (x < margin) {
    return Math.max(3 * x - 2 * margin, 0);
  } else if (width - x < margin) {
    return Math.min(margin + x * 2 - width, width);
  } else {
    return x;
  }
}

export const ChartPath: React.FC<ChartPathProps> = React.memo(
  ({
    hapticsEnabled,
    hitSlop = 0,
    width,
    height,
    stroke = 'black',
    selectedStrokeWidth = 1,
    strokeWidth = 1,
    gestureEnabled = true,
    selectedOpacity = 0.7,
    timingFeedbackConfig,
    timingAnimationConfig,
    longPressGestureHandlerProps = {},
    ...props
  }) => {
    const {
      positionX,
      positionY,
      originalX,
      originalY,
      state,
      isActive,
      progress,
      pathOpacity,
      currentPath,
      previousPath,
    } = useChartData();

    const interpolatorWorklet = useWorkletValue();

    const translationX = useSharedValue<number | null>(null);
    const translationY = useSharedValue<number | null>(null);

    const setOriginData = useWorkletCallback(
      (path: PathData, index?: number) => {
        if (!path.data.length) {
          return;
        }

        if (typeof index === 'undefined') {
          index = path.data.length - 1;
        }

        originalX.value = path.data[index].x.toString();
        originalY.value = path.data[index].y.toString();
      },
      []
    );

    const resetGestureState = useWorkletCallback(() => {
      originalX.value = '';
      originalY.value = '';
      isActive.value = false;
      pathOpacity.value = withTiming(
        1,
        timingFeedbackConfig || timingFeedbackDefaultConfig
      );
      translationX.value = null;
      translationY.value = null;
    }, []);

    useEffect(() => {
      if (currentPath?.path === previousPath?.path) {
        return;
      }

      runOnUI(() => {
        'worklet';

        // setOriginData(paths[1]);

        if (progress.value !== 0 && progress.value !== 1) {
          cancelAnimation(progress);
        }

        progress.value = 0;

        // this stores an instance of d3-interpolate-path on worklet side
        // it means that we don't cross threads with that function
        // which makes it super fast
        if (previousPath && currentPath) {
          const d3Interpolate = requireOnWorklet('d3-interpolate-path');

          interpolatorWorklet().value = d3Interpolate.interpolatePath(
            previousPath.path,
            currentPath.path
          );

          progress.value = withDelay(
            Platform.OS === 'ios' ? 0 : 100,
            withTiming(1, timingAnimationConfig || timingAnimationDefaultConfig)
          );
        } else {
          interpolatorWorklet().value = undefined;
          progress.value = 1;
        }
      })();
    }, [currentPath, previousPath]);

    useAnimatedReaction(
      () => ({ x: translationX.value, y: translationY.value }),
      values => {
        if (
          !currentPath ||
          !currentPath.parsed ||
          progress.value === 0 ||
          values.x === null ||
          values.y === null
        ) {
          return;
        }

        const yForX = redash.getYForX(currentPath.parsed, Math.floor(values.x));

        if (yForX !== null) {
          positionY.value = yForX;
        }

        positionX.value = values.x;

        const index = least(currentPath.points.length, i => {
          if (typeof i === 'undefined') {
            return 0;
          }

          return Math.hypot(currentPath.points[i].x - Math.floor(values.x));
        });

        setOriginData(currentPath, index);
      },
      [currentPath]
    );

    const animatedProps = useAnimatedProps(() => {
      const props: PathProps & ViewProps = {};

      if (!currentPath) {
        return {
          d: '',
        };
      }

      props.d = interpolatorWorklet().value
        ? interpolatorWorklet().value(progress.value)
        : currentPath.path;

      props.strokeWidth =
        pathOpacity.value *
          (Number(strokeWidth) - Number(selectedStrokeWidth)) +
        Number(selectedStrokeWidth);

      if (Platform.OS === 'ios') {
        props.style = {
          opacity: pathOpacity.value * (1 - selectedOpacity) + selectedOpacity,
        };
      }

      return props;
    }, [currentPath]);

    const onGestureEvent = useAnimatedGestureHandler<LongPressGestureHandlerGestureEvent>(
      {
        onStart: event => {
          // WARNING: the following code does not run on using iOS, but it does on Android.
          // I use the same code from onActive
          state.value = event.state;
          isActive.value = true;
          pathOpacity.value = withTiming(
            0,
            timingFeedbackConfig || timingFeedbackDefaultConfig
          );

          if (hapticsEnabled) {
            impactHeavy();
          }
        },
        onActive: event => {
          if (!isActive.value) {
            isActive.value = true;

            pathOpacity.value = withTiming(
              0,
              timingFeedbackConfig || timingFeedbackDefaultConfig
            );

            if (hapticsEnabled) {
              impactHeavy();
            }
          }

          state.value = event.state;
          translationX.value = positionXWithMargin(event.x, hitSlop, width);
          translationY.value = event.y;
        },
        onFail: event => {
          state.value = event.state;
          resetGestureState();
        },
        onCancel: event => {
          state.value = event.state;
          resetGestureState();
        },
        onEnd: event => {
          state.value = event.state;
          resetGestureState();

          if (hapticsEnabled) {
            impactHeavy();
          }
        },
      },
      [width, height, hapticsEnabled, hitSlop, timingFeedbackConfig]
    );

    const pathAnimatedStyles = useAnimatedStyle(() => {
      return {
        opacity: pathOpacity.value * (1 - selectedOpacity) + selectedOpacity,
      };
    }, []);

    return (
      <View style={{ width, height }}>
        <LongPressGestureHandler
          {...{ onGestureEvent }}
          enabled={gestureEnabled}
          maxDist={100000}
          minDurationMs={0}
          shouldCancelWhenOutside={false}
          {...longPressGestureHandlerProps}
        >
          <Animated.View>
            <Svg
              viewBox={`0 0 ${width} ${height}`}
              style={{ width, height: height + 20 }}
            >
              <AnimatedPath
                // @ts-expect-error
                style={pathAnimatedStyles}
                animatedProps={animatedProps}
                stroke={stroke}
                strokeWidth={strokeWidth}
                {...props}
              />
            </Svg>
          </Animated.View>
        </LongPressGestureHandler>
      </View>
    );
  }
);
