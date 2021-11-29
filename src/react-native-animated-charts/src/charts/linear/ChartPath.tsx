import { scaleLinear } from 'd3-scale';
import * as shape from 'd3-shape';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Dimensions, StyleSheet, View, ViewStyle } from 'react-native';
import {
  LongPressGestureHandler,
  LongPressGestureHandlerGestureEvent,
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
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { getYForX, parse as parseSvgPath } from 'react-native-redash';
import Svg, { Path } from 'react-native-svg';
import { CurveType, DataType } from '../../helpers/ChartContext';
import {
  requireOnWorklet,
  useWorkletValue,
} from '../../helpers/requireOnWorklet';
import { useChartData } from '../../helpers/useChartData';

function ascending(a, b) {
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

function least(length, compare = ascending) {
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

const springDefaultConfig = {
  damping: 15,
  mass: 1,
  stiffness: 600,
};

const timingFeedbackDefaultConfig = {
  duration: 80,
};

const timingAnimationDefaultConfig = {
  duration: 300,
};

const AnimatedPath = Animated.createAnimatedComponent(Path);

function getCurveType(curveType: CurveType) {
  switch (curveType) {
    case CurveType.basis:
      return shape.curveBasis;
    case CurveType.bump:
      return shape.curveBumpX;
    case CurveType.linear:
      return shape.curveLinear;
    case CurveType.monotone:
      return shape.curveMonotoneX;
    case CurveType.natural:
      return shape.curveNatural;
    case CurveType.step:
      return shape.curveStep;

    default:
      return shape.curveBasis;
  }
}

type CallbackType = {
  data: DataType;
  width: number;
  height: number;
};

interface ChartPathProps {
  hapticsEnabled?: boolean;
  hitSlop?: number;
  fill?: string;
  height: number;
  width: number;
  selectedStrokeWidth?: number;
  selectedOpacity?: number;
  strokeWidth?: number;
  stroke?: string;
  springConfig?: Animated.WithSpringConfig;
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

export const ChartPath: React.FC<ChartPathProps> = ({
  hapticsEnabled,
  hitSlop = 0,
  width,
  height,
  stroke = 'black',
  selectedStrokeWidth = 4,
  strokeWidth = 2,
  selectedOpacity = 0.5,
  timingFeedbackConfig,
  timingAnimationConfig,
}) => {
  const {
    data,
    positionX,
    positionY,
    originalX,
    originalY,
    state,
    isActive,
    progress,
    pathOpacity,
  } = useChartData();

  const initialized = useRef(false);
  const interpolatorWorklet = useWorkletValue();

  const getScales = useCallback(({ data, width, height }: CallbackType) => {
    const x = data.points.map(item => item.x);
    const y = data.points.map(item => item.y);

    const scaleX = scaleLinear()
      .domain([Math.min(...x), Math.max(...x)])
      .range([0, width]);

    const scaleY = scaleLinear()
      .domain([Math.min(...y), Math.max(...y)])
      .range([height, 0]);

    return {
      scaleY,
      scaleX,
    };
  }, []);

  const createPath = useCallback(({ data, width, height }: CallbackType) => {
    const { scaleX, scaleY } = getScales({ data, width, height });

    const points = [];

    for (let i = 0; i < data.points.length; i++) {
      points.push({
        x: scaleX(data.points[i].x),
        y: scaleY(data.points[i].y),
      });
    }

    const path = shape
      .line()
      .x(item => scaleX(item.x))
      .y(item => scaleY(item.y))
      .curve(getCurveType(data.curve))(data.points);

    const parsed = parseSvgPath(path);

    return { path, parsed, points, data: data.points };
  }, []);

  const initialPath = useMemo(() => createPath({ data, width, height }), []);

  const [paths, setPaths] = useState(() => [initialPath, initialPath]);

  useEffect(() => {
    if (initialized.current) {
      setPaths(([_, curr]) => [curr, createPath({ data, width, height })]);
    } else {
      initialized.current = true;
    }
  }, [data.points, data.curve, width, height]);

  useEffect(() => {
    if (paths[0].path === paths[1].path) {
      return;
    }

    runOnUI(() => {
      'worklet';

      if (progress.value !== 0 && progress.value !== 1) {
        cancelAnimation(progress);
      }

      // this stores an instance of d3-interpolate-path on worklet side
      // it means that we don't cross threads with that function
      // which makes it super fast
      interpolatorWorklet().value = requireOnWorklet(
        'd3-interpolate-path'
      ).interpolatePath(paths[0].path, paths[1].path);

      progress.value = 0;

      progress.value = withDelay(
        100,
        withTiming(1, timingAnimationConfig || timingAnimationDefaultConfig)
      );
    })();
  }, [paths]);

  useAnimatedReaction(
    () => ({ x: positionX.value, y: positionY.value }),
    values => {
      const path = paths[1];

      console.log(values);

      const index = least(path.points.length, i =>
        Math.hypot(path.points[i].x - Math.floor(values.x))
      );

      const yForX = getYForX(path.parsed, Math.floor(values.x));

      // activeIndex.value = index;
      positionX.value = values.x;
      positionY.value = yForX;
      originalX.value = path.data[index].x.toString();
      originalY.value = path.data[index].y.toString();
    },
    [paths, data]
  );

  const animatedProps = useAnimatedProps(() => {
    const d = interpolatorWorklet().value
      ? interpolatorWorklet().value(progress.value)
      : paths[1].path;

    return {
      d,
      strokeWidth:
        pathOpacity.value *
          (Number(strokeWidth) - Number(selectedStrokeWidth)) +
        Number(selectedStrokeWidth),
    };
  }, [paths]);

  const onGestureEvent = useAnimatedGestureHandler<LongPressGestureHandlerGestureEvent>(
    {
      onStart: event => {
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
        state.value = event.state;
        positionX.value = positionXWithMargin(event.x, hitSlop, width);
        positionY.value = event.y;
      },
      onFail: event => {
        console.log('fail');
        state.value = event.state;
        isActive.value = false;
        pathOpacity.value = withTiming(
          1,
          timingFeedbackConfig || timingFeedbackDefaultConfig
        );
      },
      onCancel: event => {
        console.log('cancel');
        state.value = event.state;
        isActive.value = false;
        pathOpacity.value = withTiming(
          1,
          timingFeedbackConfig || timingFeedbackDefaultConfig
        );
      },
      onEnd: event => {
        state.value = event.state;
        isActive.value = false;
        pathOpacity.value = withTiming(
          1,
          timingFeedbackConfig || timingFeedbackDefaultConfig
        );

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
      <Svg viewBox={`0 0 ${width + 1} ${height + 1}`} style={{ width, height }}>
        <AnimatedPath
          style={pathAnimatedStyles}
          animatedProps={animatedProps}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      </Svg>
      <LongPressGestureHandler
        {...{ onGestureEvent }}
        maxDist={100000}
        minDurationMs={0}
        shouldCancelWhenOutside={false}
      >
        <Animated.View style={StyleSheet.absoluteFill} />
      </LongPressGestureHandler>
    </View>
  );
};

const SIZE = Dimensions.get('window').width;

const CURSOR = 16;

const styles = StyleSheet.create({
  cursorBody: {
    zIndex: 1,
    width: CURSOR,
    height: CURSOR,
    borderRadius: 7.5,
    backgroundColor: 'red',
  },
});

interface ChartDotProps {
  style?: ViewStyle;
  springConfig?: Animated.WithSpringConfig;
}

const ChartDot: React.FC<ChartDotProps> = ({ style, springConfig }) => {
  const { isActive, positionX, positionY } = useChartData();

  const animatedStyle = useAnimatedStyle(() => {
    const translateX = positionX.value - CURSOR / 2;
    const translateY = positionY.value - CURSOR / 2;

    return {
      opacity: withSpring(
        isActive.value ? 1 : 0,
        springConfig || springDefaultConfig
      ),
      transform: [
        { translateX },
        { translateY },
        {
          scale: withSpring(
            isActive.value ? 1 : 0,
            springConfig || springDefaultConfig
          ),
        },
      ],
    };
  });

  return (
    <Animated.View style={[StyleSheet.absoluteFill]}>
      <Animated.View style={[styles.cursorBody, style, animatedStyle]} />
    </Animated.View>
  );
};